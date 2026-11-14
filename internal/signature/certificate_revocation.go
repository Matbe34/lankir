package signature

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/Matbe34/lankir/internal/signature/pkcs12"
	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/verify"
	"golang.org/x/crypto/ocsp"
)

// CertificateRevocation says whether a certificate offered for signing was revoked.
type CertificateRevocation struct {
	// Status is "good", "revoked", "unavailable" (no usable answer) or
	// "not_checked" (setting off, untrusted chain, nothing to ask).
	Status string `json:"status"`
	// Check says how it was checked, or why not.
	Check string `json:"check"`
	// RevokedAt is when it was revoked, RFC 3339; empty unless revoked.
	RevokedAt string `json:"revokedAt"`
}

// How long, and for how many certificates, an answer is kept.
const (
	certRevocationTTL  = 5 * time.Minute
	certRevocationSize = 32
)

type certRevocationEntry struct {
	result CertificateRevocation
	at     time.Time
}

// CheckCertificateRevocation asks the certificate authority whether the
// certificate with this fingerprint was revoked, with the rules verifying
// follows: only for a chain this system trusts, only the OCSP and CRL servers
// the certificate itself names, OCSP first and then an HTTP CRL. An answer is
// kept for a few minutes, unless a server didn't answer.
func (s *SignatureService) CheckCertificateRevocation(fingerprint string) (CertificateRevocation, error) {
	if !s.checkRevocationOnline() {
		return CertificateRevocation{Status: "not_checked", Check: "Not checked (turned off in settings)"}, nil
	}
	s.mu.RLock()
	entry, ok := s.certRevocations[fingerprint]
	s.mu.RUnlock()
	if ok && time.Since(entry.at) < certRevocationTTL {
		return entry.result, nil
	}

	// Only the certificates the sign panel listed: listing again loads the
	// PKCS#11 modules, which a smart card signing meanwhile may be using.
	s.mu.RLock()
	cert, ok := s.listed[fingerprint]
	s.mu.RUnlock()
	if !ok {
		return CertificateRevocation{Status: "not_checked", Check: "Not checked: the certificate isn't in the list"}, nil
	}
	// A locked .p12 can't be read before signing supplies its password.
	if cert.X509Cert == nil {
		return CertificateRevocation{Status: "not_checked", Check: "Not checked: the certificate file is locked"}, nil
	}
	result, unanswered := checkRevocation(cert.X509Cert, issuersFrom(cert))
	if unanswered {
		return result, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.certRevocations == nil {
		s.certRevocations = map[string]certRevocationEntry{}
	}
	keepUnder(s.certRevocations, certRevocationSize, func(e certRevocationEntry) time.Time { return e.at })
	s.certRevocations[fingerprint] = certRevocationEntry{result, time.Now()}
	return result, nil
}

// issuersFrom are the other certificates the certificate's backend holds,
// which may be its issuing chain: a .p12's CA certificates, the NSS
// database's as listed.
func issuersFrom(cert types.Certificate) []*x509.Certificate {
	if ext := strings.ToLower(cert.FilePath); strings.HasSuffix(ext, ".p12") || strings.HasSuffix(ext, ".pfx") {
		return pkcs12.CACertificates(cert.FilePath)
	}
	return cert.Issuers
}

// checkRevocation asks about leaf, issued under intermediates by a trusted
// root. unanswered: a server it names gave no usable answer, so asking again
// later may give one.
func checkRevocation(leaf *x509.Certificate, intermediates []*x509.Certificate) (_ CertificateRevocation, unanswered bool) {
	pool := x509.NewCertPool()
	for _, c := range intermediates {
		pool.AddCert(c)
	}
	chains, err := leaf.Verify(x509.VerifyOptions{Roots: trustedRoots, Intermediates: pool, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}})
	if err != nil {
		return CertificateRevocation{Status: "not_checked", Check: "Not checked: the issuer isn't trusted"}, false
	}
	if len(chains[0]) < 2 {
		return CertificateRevocation{Status: "not_checked", Check: "Not checked: the certificate is its own issuer"}, false
	}
	issuer := chains[0][1]

	// Only the hosts the certificate names; a redirect elsewhere is refused.
	hosts := map[string]bool{}
	for _, u := range slices.Concat(leaf.OCSPServer, leaf.CRLDistributionPoints) {
		if parsed, err := url.Parse(u); err == nil && parsed.Host != "" {
			hosts[parsed.Host] = true
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), revocationTotalTimeout)
	defer cancel()
	client := &http.Client{Timeout: revocationRequestTimeout, Transport: hostFilter{hosts, http.DefaultTransport}}
	revoked := func(at time.Time, by string) CertificateRevocation {
		return CertificateRevocation{Status: "revoked", Check: by + " checked online with the certificate authority", RevokedAt: at.UTC().Format(time.RFC3339)}
	}

	// What verifying reads from pdfsign, filled in the way pdfsign does.
	c := verify.Certificate{Certificate: leaf}
	if resp := askOCSP(ctx, client, leaf, issuer); resp != nil {
		c.OCSPResponse, c.OCSPExternal = resp, true
	}
	ocspVerified := ocspSignedBy(c.OCSPResponse, issuer)
	if ocspVerified && c.OCSPResponse.Status == ocsp.Revoked {
		return revoked(c.OCSPResponse.RevokedAt, "OCSP"), false
	}
	if !ocspVerified || c.OCSPResponse.Status != ocsp.Good {
		if crl := askCRL(ctx, client, leaf, issuer); crl != nil {
			c.CRLExternal = true
			for _, entry := range crl.RevokedCertificateEntries {
				if entry.SerialNumber.Cmp(leaf.SerialNumber) == 0 {
					return revoked(entry.RevocationTime, "CRL"), false
				}
			}
		}
	}
	status, check, unanswered := certRevocation(c, issuer, true, true)
	if status == "none" {
		status = "not_checked"
	}
	return CertificateRevocation{Status: status, Check: check}, unanswered
}

// askOCSP is the first answer about cert, from the OCSP servers it names,
// that issuer or a responder certificate it issued signed.
func askOCSP(ctx context.Context, client *http.Client, cert, issuer *x509.Certificate) *ocsp.Response {
	req, err := ocsp.CreateRequest(cert, issuer, nil)
	if err != nil {
		return nil
	}
	for _, u := range cert.OCSPServer {
		body, err := fetch(ctx, client, http.MethodPost, u, req, "application/ocsp-request", "application/ocsp-response", verify.DefaultMaxOCSPResponseBytes)
		if err != nil {
			continue
		}
		resp, err := ocsp.ParseResponseForCert(body, cert, issuer)
		if err != nil {
			continue
		}
		// Past its next update, only a revocation (not a hold, which may have
		// been lifted) still counts.
		if !stale(resp.NextUpdate) || resp.Status == ocsp.Revoked && resp.RevocationReason != ocsp.CertificateHold {
			return resp
		}
	}
	return nil
}

// askCRL is the first CRL issuer signed from the HTTP distribution points cert
// names that is current, or past its next update but revoking cert: an old
// list that doesn't is no answer, and a hold in one may have been lifted since.
func askCRL(ctx context.Context, client *http.Client, cert, issuer *x509.Certificate) *x509.RevocationList {
	for _, u := range cert.CRLDistributionPoints {
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		body, err := fetch(ctx, client, http.MethodGet, u, nil, "", "application/pkix-crl", maxCRLBytes)
		if err != nil {
			continue
		}
		// Some CAs serve the CRL as PEM.
		if block, _ := pem.Decode(body); block != nil {
			body = block.Bytes
		}
		crl, err := x509.ParseRevocationList(body)
		if err != nil || crl.CheckSignatureFrom(issuer) != nil {
			continue
		}
		if !stale(crl.NextUpdate) || slices.ContainsFunc(crl.RevokedCertificateEntries, func(e x509.RevocationListEntry) bool {
			return e.SerialNumber.Cmp(cert.SerialNumber) == 0 && e.ReasonCode != ocsp.CertificateHold
		}) {
			return crl
		}
	}
	return nil
}

// stale says an answer's next update, when it has one, has passed.
func stale(nextUpdate time.Time) bool {
	return !nextUpdate.IsZero() && nextUpdate.Before(time.Now())
}

// fetch sends one request and reads a 200 answer of at most limit bytes.
func fetch(ctx context.Context, client *http.Client, method, target string, body []byte, contentType, accept string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", accept)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered %s", target, resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s answered more than %d bytes", target, limit)
	}
	return data, nil
}

// keepUnder drops the oldest entries of m until there is room for one more.
func keepUnder[K comparable, V any](m map[K]V, size int, at func(V) time.Time) {
	for len(m) >= size {
		var oldest K
		found := false
		for k, v := range m {
			if !found || at(v).Before(at(m[oldest])) {
				oldest, found = k, true
			}
		}
		delete(m, oldest)
	}
}
