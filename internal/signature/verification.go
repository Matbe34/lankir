package signature

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/verify"
	"golang.org/x/crypto/ocsp"
)

// Bounds on asking certificate authorities about revocation: each request,
// all of them for one PDF, so an offline network can't stall verifying, and
// the size of a downloaded CRL (pdfsign's own limit is 256 MiB).
const (
	revocationRequestTimeout = 10 * time.Second
	revocationTotalTimeout   = 30 * time.Second
	maxCRLBytes              = 32 << 20
)

// How long, and for how many files, a verification is kept for a file
// unchanged on disk: switching tabs and saving ask again.
const (
	verifiedTTL  = 10 * time.Minute
	verifiedSize = 32
)

// verifiedKey names a file's contents on disk and the setting it was checked with.
type verifiedKey struct {
	path   string
	size   int64
	mtime  int64
	online bool
}

type verifiedEntry struct {
	signatures []types.SignatureInfo
	at         time.Time
}

// verifyOptions are pdfsign's defaults, asking the OCSP/CRL servers the
// certificates name when online is set.
func verifyOptions(ctx context.Context, online bool) *verify.VerifyOptions {
	opts := verify.DefaultVerifyOptions() //nolint:staticcheck // SA1019: legacy API; replaced in T-001 M6
	opts.EnableExternalRevocationCheck = online
	opts.TrustedRoots = trustedRoots
	opts.HTTPTimeout = revocationRequestTimeout
	opts.MaxCRLResponseBytes = maxCRLBytes
	opts.Context = ctx
	return opts
}

// checkRevocationOnline is the user's setting; on when there is no config.
func (s *SignatureService) checkRevocationOnline() bool {
	return s.configService == nil || s.configService.Get().CheckRevocationOnline
}

// VerifySignatures validates all digital signatures in a PDF and returns their
// status, the same one for a file unchanged on disk for verifiedTTL.
func (s *SignatureService) VerifySignatures(pdfPath string) ([]types.SignatureInfo, error) {
	return s.verifySignatures(pdfPath, s.checkRevocationOnline())
}

// VerifySignaturesOffline is VerifySignatures without asking any certificate
// authority, whatever the setting.
func (s *SignatureService) VerifySignaturesOffline(pdfPath string) ([]types.SignatureInfo, error) {
	cached, err := s.verifySignatures(pdfPath, false)
	// The setting had no say here. A copy: the cache answers the setting too.
	signatures := slices.Clone(cached)
	for i := range signatures {
		signatures[i].RevocationCheck = strings.ReplaceAll(signatures[i].RevocationCheck, " (turned off in settings)", " online (offline check)")
	}
	return signatures, err
}

func (s *SignatureService) verifySignatures(pdfPath string, online bool) ([]types.SignatureInfo, error) {
	path, err := filepath.Abs(pdfPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open PDF: %w", err)
	}
	stat, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open PDF: %w", err)
	}
	key := verifiedKey{path, stat.Size(), stat.ModTime().UnixNano(), online}
	s.mu.RLock()
	entry, ok := s.verified[key]
	s.mu.RUnlock()
	if ok && time.Since(entry.at) < verifiedTTL {
		return entry.signatures, nil
	}

	signatures, unanswered, err := verifyPDF(s, path, online)
	if err != nil {
		return nil, err
	}
	// A revocation service that didn't answer may answer the next time.
	if unanswered {
		return signatures, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.verified == nil {
		s.verified = map[verifiedKey]verifiedEntry{}
	}
	keepUnder(s.verified, verifiedSize, func(e verifiedEntry) time.Time { return e.at })
	s.verified[key] = verifiedEntry{signatures, time.Now()}
	return signatures, nil
}

// revocationHosts are the hosts in the OCSP and CRL URLs of the certificates
// of trusted signers, from the signer up through each issuer that signed it.
func revocationHosts(response *verify.Response) map[string]bool {
	hosts := map[string]bool{}
	if response == nil {
		return hosts
	}
	for _, signer := range response.Signers {
		if !signer.TrustedIssuer {
			continue
		}
		for _, c := range orderedChain(signer.Certificates) {
			for _, u := range slices.Concat(c.Certificate.OCSPServer, c.Certificate.CRLDistributionPoints) {
				if parsed, err := url.Parse(u); err == nil && parsed.Host != "" {
					hosts[parsed.Host] = true
				}
			}
		}
	}
	return hosts
}

// hostFilter sends a request, a redirected one included, only to an allowed host.
type hostFilter struct {
	allowed map[string]bool
	next    http.RoundTripper
}

func (f hostFilter) RoundTrip(req *http.Request) (*http.Response, error) {
	if !f.allowed[req.URL.Host] {
		return nil, fmt.Errorf("no trusted certificate names %s", req.URL.Host)
	}
	return f.next.RoundTrip(req)
}

// verifyPDF is swapped in tests to count verifications.
var verifyPDF = (*SignatureService).verifyPDF

// It also says whether a revocation service went unanswered (see revocationOf).
func (s *SignatureService) verifyPDF(pdfPath string, online bool) (_ []types.SignatureInfo, unanswered bool, _ error) {
	file, err := os.Open(pdfPath)
	if err != nil {
		return nil, false, fmt.Errorf("failed to open PDF: %w", err)
	}
	defer file.Close()

	ctx, cancel := context.WithTimeout(context.Background(), revocationTotalTimeout)
	defer cancel()
	// Offline first, then online only for a chain the system trusts: online,
	// pdfsign fetches the CRL every certificate names, and an untrusted one's
	// URLs are whatever the PDF's author chose. With signers of mixed trust
	// pdfsign still tries those in the second pass, so its client may reach
	// only the hosts the trusted chains name.
	response, err := verify.VerifyFileWithOptions(file, verifyOptions(ctx, false)) //nolint:staticcheck // SA1019: legacy API; replaced in T-001 M6
	if hosts := revocationHosts(response); err == nil && online && len(hosts) > 0 {
		if _, err = file.Seek(0, io.SeekStart); err == nil {
			opts := verifyOptions(ctx, true)
			// pdfsign ignores HTTPTimeout once given a client.
			opts.HTTPClient = &http.Client{Timeout: revocationRequestTimeout, Transport: hostFilter{hosts, http.DefaultTransport}}
			response, err = verify.VerifyFileWithOptions(file, opts) //nolint:staticcheck // SA1019: legacy API; replaced in T-001 M6
		}
	}
	if err != nil {
		errMsg := err.Error()

		// SigFlags without any signed /Sig field is a form prepared for signing, not a broken signature.
		if strings.Contains(errMsg, "no digital signature in document") ||
			strings.Contains(errMsg, "SigFlags implies signatures but none found") {
			return []types.SignatureInfo{}, false, nil
		}
		return nil, false, fmt.Errorf("verification failed: %w", err)
	}

	if len(response.Signers) == 0 {
		return []types.SignatureInfo{}, false, nil
	}

	var signatures []types.SignatureInfo
	for _, signer := range response.Signers {
		sigInfo, retry := s.convertSignerToInfo(signer, response.Error, online)
		signatures = append(signatures, sigInfo)
		unanswered = unanswered || retry
	}

	return signatures, unanswered, nil
}

// convertSignerToInfo also says whether a revocation service went unanswered (see revocationOf).
func (s *SignatureService) convertSignerToInfo(signer verify.Signer, responseError string, online bool) (_ types.SignatureInfo, unanswered bool) {
	revoked := isRevoked(signer)
	info := types.SignatureInfo{
		SignerName:       signer.Name,
		Reason:           signer.Reason,
		Location:         signer.Location,
		ContactInfo:      signer.ContactInfo,
		IsValid:          signer.ValidSignature,
		CertificateValid: signer.TrustedIssuer && !revoked,
		IssuerTrusted:    signer.TrustedIssuer,
	}

	// A valid timestamp beats the signer's own unverified clock. Without a
	// recorded time, VerificationTime is only when this check ran.
	stamped := signer.VerificationTime != nil && signer.TimeSource == "embedded_timestamp"
	if stamped && (signer.TimestampStatus == "valid" || signer.SignatureTime == nil) {
		info.SigningTime = signer.VerificationTime.UTC().Format(time.RFC3339)
		info.SigningTimeSource = "timestamp"
	} else if signer.SignatureTime != nil {
		info.SigningTime = signer.SignatureTime.UTC().Format(time.RFC3339)
		info.SigningTimeSource = "signer"
	}

	info.TimestampStatus = timestampStatus(signer.TimestampStatus)
	if signer.TimeStamp != nil && !signer.TimeStamp.Time.IsZero() {
		info.TimestampTime = signer.TimeStamp.Time.UTC().Format(time.RFC3339)
	}

	info.Warnings = []string{}
	for _, warning := range signer.Warnings {
		info.Warnings = append(info.Warnings, warning.Error())
	}
	info.Chain = chainOf(signer.Certificates)
	info.RevocationStatus, info.RevocationCheck, unanswered = revocationOf(signer, online)

	if len(signer.Certificates) > 0 {
		certWrapper := signer.Certificates[0]
		if certWrapper.Certificate != nil {
			cert := certWrapper.Certificate
			info.SignerDN = cert.Subject.String()
			if info.SignerName == "" {
				info.SignerName = cert.Subject.CommonName
				if info.SignerName == "" {
					info.SignerName = cert.Subject.String()
				}
			}
			info.SignatureType = cert.SignatureAlgorithm.String()
			info.KeyAlgorithm = keyAlgorithm(cert)
			info.IssuerName = commonName(cert.Issuer)
			info.IssuerDN = cert.Issuer.String()
			info.CertificateSerial = colonHex(cert.SerialNumber.Bytes())
			info.CertificateValidFrom = cert.NotBefore.UTC().Format(time.RFC3339)
			info.CertificateValidUntil = cert.NotAfter.UTC().Format(time.RFC3339)

			if certWrapper.VerifyError != "" {
				if info.CertificateValidationMessage != "" {
					info.CertificateValidationMessage += "; " + certWrapper.VerifyError
				} else {
					info.CertificateValidationMessage = certWrapper.VerifyError
				}
			}
		}
	}

	if signer.ValidSignature {
		info.ValidationMessage = "Signature is cryptographically valid"
	} else {
		info.ValidationMessage = "Signature validation failed"
		if responseError != "" {
			info.ValidationMessage += ": " + responseError
		}
		for _, warning := range signer.Warnings {
			info.ValidationMessage += "; " + warning.Error()
		}
	}

	if revoked {
		info.CertificateValidationMessage = "Certificate has been revoked"
		info.CertificateValid = false

		if len(signer.Certificates) > 0 {
			certWrapper := signer.Certificates[0]
			if certWrapper.RevocationTime != nil && !unknownOnly(certWrapper) {
				info.CertificateValidationMessage += " on " + certWrapper.RevocationTime.Format("2006-01-02 15:04:05")
			}
			if certWrapper.RevokedBeforeSigning && !unknownOnly(certWrapper) {
				info.CertificateValidationMessage += " (revoked before signing)"
			}
		}
	} else if signer.TrustedIssuer {
		info.CertificateValidationMessage = "Certificate is valid and trusted"
	} else {
		info.CertificateValidationMessage = "Certificate chain validation issue (not in system trust store)"

		if len(signer.Certificates) > 0 {
			certWrapper := signer.Certificates[0]
			if certWrapper.KeyUsageError != "" {
				info.CertificateValidationMessage += "; Key usage: " + certWrapper.KeyUsageError
			}
			if certWrapper.ExtKeyUsageError != "" {
				info.CertificateValidationMessage += "; Extended key usage: " + certWrapper.ExtKeyUsageError
			}
		}
	}

	switch signer.TimestampStatus {
	case "", "missing":
	case "valid":
		info.ValidationMessage += " with valid trusted timestamp"
	case "untrusted":
		info.ValidationMessage += " with valid but untrusted timestamp"
	default:
		info.ValidationMessage += " with invalid timestamp"
	}

	return info, unanswered
}

func timestampStatus(status string) string {
	switch status {
	case "", "missing":
		return "none"
	case "valid", "untrusted":
		return status
	default:
		return "invalid"
	}
}

// keyAlgorithm names a public key with its size or curve: "RSA 2048", "ECDSA P-256".
func keyAlgorithm(cert *x509.Certificate) string {
	switch key := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA %d", key.N.BitLen())
	case *ecdsa.PublicKey:
		return "ECDSA " + key.Curve.Params().Name
	case ed25519.PublicKey:
		return "Ed25519"
	}
	return cert.PublicKeyAlgorithm.String()
}

// commonName is a name's CN, else its organization, else the whole DN.
func commonName(name pkix.Name) string {
	if name.CommonName != "" {
		return name.CommonName
	}
	if len(name.Organization) > 0 {
		return name.Organization[0]
	}
	return name.String()
}

// colonHex writes bytes as "4C:1F:0A".
func colonHex(b []byte) string {
	if len(b) == 0 {
		return "00"
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02X", v)
	}
	return strings.Join(parts, ":")
}

// chainOf names the embedded certificates from the signer up through each
// issuer the PDF carries.
func chainOf(certs []verify.Certificate) []types.ChainCertificate {
	chain := []types.ChainCertificate{}
	for _, c := range orderedChain(certs) {
		chain = append(chain, types.ChainCertificate{Subject: commonName(c.Certificate.Subject), Issuer: commonName(c.Certificate.Issuer)})
	}
	return chain
}

// orderedChain orders the embedded certificates from the signer up through
// each issuer the PDF carries; pdfsign lists the signer first, the rest
// unordered. An issuer must have signed the certificate below it: the PDF's
// certificate set isn't signed, so a name alone could be anyone's. Under a
// trusted signer it must also chain to a trusted root itself (pdfsign sets
// VerifyError on each one that doesn't), since a forgery can carry the real
// issuer's name and key.
func orderedChain(certs []verify.Certificate) []verify.Certificate {
	if len(certs) == 0 || certs[0].Certificate == nil {
		return nil
	}
	chain := []verify.Certificate{certs[0]}
	trusted := certs[0].VerifyError == ""
	used := map[int]bool{0: true}
	for cert := certs[0].Certificate; !selfIssued(cert); {
		next := -1
		for i, c := range certs {
			if !used[i] && c.Certificate != nil && (!trusted || c.VerifyError == "") &&
				bytes.Equal(c.Certificate.RawSubject, cert.RawIssuer) && cert.CheckSignatureFrom(c.Certificate) == nil {
				next = i
				break
			}
		}
		if next < 0 {
			break
		}
		used[next] = true
		chain = append(chain, certs[next])
		cert = certs[next].Certificate
	}
	return chain
}

func selfIssued(cert *x509.Certificate) bool {
	return bytes.Equal(cert.RawSubject, cert.RawIssuer)
}

// revocationOf says whether the signer's certificate, and the intermediates
// above it, were checked for revocation, and how: data embedded in the PDF or
// an online answer from the certificate authority. unanswered: a revocation
// service of a certificate left without a good answer didn't answer, so asking
// again later may give one.
func revocationOf(signer verify.Signer, online bool) (status, check string, unanswered bool) {
	chain := orderedChain(signer.Certificates)
	if len(chain) == 0 {
		return "not_checked", "Not checked", false
	}
	at := time.Now()
	if signer.VerificationTime != nil {
		at = *signer.VerificationTime
	}
	// Only an OCSP answer needs the issuer looked up again.
	issuer := func(c verify.Certificate) *x509.Certificate {
		if c.OCSPResponse == nil {
			return nil
		}
		return issuerOf(c.Certificate, signer.Certificates, at)
	}
	status, check, unanswered = certRevocation(chain[0], issuer(chain[0]), online, signer.TrustedIssuer)
	if status == "none" {
		status = "not_checked"
	}
	parts := []string{check}
	// pdfsign checks the intermediates only once the chain is trusted.
	if signer.TrustedIssuer {
		for _, c := range chain[1:] {
			if selfIssued(c.Certificate) {
				continue
			}
			s, text, retry := certRevocation(c, issuer(c), online, true)
			unanswered = unanswered || retry
			if s == "good" || s == "none" {
				continue
			}
			if text != check {
				parts = append(parts, commonName(c.Certificate.Subject)+": "+strings.ToLower(text[:1])+text[1:])
			}
			if status == "good" || (status == "not_checked" && s == "unavailable") {
				status = s
			}
		}
	}
	if isRevoked(signer) {
		return "revoked", strings.Join(parts, "; "), unanswered
	}
	// pdfsign marks a revocation after a trusted signing time only by its date.
	// Under an untrusted issuer that date comes from data nobody checked.
	for i, c := range chain {
		if !signer.TrustedIssuer || c.RevocationTime == nil || unknownOnly(c) {
			continue
		}
		text := "Revoked on " + c.RevocationTime.UTC().Format("2 Jan 2006") + ", after the trusted signing time"
		if i > 0 {
			text = commonName(c.Certificate.Subject) + ": r" + text[1:]
		}
		return "revoked_later", text, unanswered
	}
	return status, strings.Join(parts, "; "), unanswered
}

// isRevoked is pdfsign's verdict, less a revocation it read into an OCSP
// "unknown" (any answer but "good", at the zero time): with one, only another
// revocation before signing counts, as pdfsign counts it without the unknown.
func isRevoked(signer verify.Signer) bool {
	if !signer.RevokedCertificate {
		return false
	}
	if !slices.ContainsFunc(signer.Certificates, func(c verify.Certificate) bool {
		return c.OCSPResponse != nil && c.OCSPResponse.Status == ocsp.Unknown
	}) {
		return true
	}
	return slices.ContainsFunc(signer.Certificates, func(c verify.Certificate) bool {
		return c.RevocationTime != nil && !unknownOnly(c) && signer.IsRevokedBeforeSigning(*c.RevocationTime)
	})
}

// unknownOnly says the certificate's revocation time is only pdfsign's reading of an OCSP "unknown".
func unknownOnly(c verify.Certificate) bool {
	return c.RevocationTime != nil && c.RevocationTime.IsZero() && c.OCSPResponse != nil && c.OCSPResponse.Status == ocsp.Unknown
}

// certRevocation is one certificate's revocation status: "good" only from an
// answer whose signature checks out against a trusted issuer, else
// "unavailable", "not_checked" or "none" (no service named). unanswered: a
// service it names that pdfsign asks online gave no answer.
func certRevocation(c verify.Certificate, issuer *x509.Certificate, online, trusted bool) (status, check string, unanswered bool) {
	cert := c.Certificate
	hasOCSP := len(cert.OCSPServer) > 0
	if !hasOCSP && len(cert.CRLDistributionPoints) == 0 && !c.OCSPEmbedded && !c.CRLEmbedded {
		return "none", "The certificate names no revocation service", false
	}
	// Without a trusted chain pdfsign has no issuer to check an answer against.
	if !trusted {
		return "not_checked", "Not checked: the issuer isn't trusted", false
	}
	var sources []string
	// pdfsign keeps an embedded OCSP answer whose signature fails, and takes
	// an online one from any certificate the issuer signed, so check both here.
	ocspVerified := ocspSignedBy(c.OCSPResponse, issuer)
	// "Unknown" says nothing about revocation.
	unknown := ocspVerified && c.OCSPResponse.Status == ocsp.Unknown
	if c.OCSPEmbedded && ocspVerified && !unknown {
		sources = append(sources, "Embedded in the PDF")
	}
	var asked []string
	if c.OCSPExternal && ocspVerified && !unknown {
		asked = append(asked, "OCSP")
	}
	// A downloaded CRL is checked against the issuer pdfsign found for a
	// trusted chain; a self-signed certificate has none, so its CRL is not.
	if c.CRLExternal && !selfIssued(cert) {
		asked = append(asked, "CRL")
	}
	if len(asked) > 0 {
		sources = append(sources, strings.Join(asked, " and ")+" checked online with the certificate authority")
	}
	if len(sources) > 0 {
		return "good", strings.Join(sources, "; "), false
	}
	// pdfsign downloads a CRL over HTTP only; FNMT, for one, also lists LDAP ones.
	hasCRL := slices.ContainsFunc(cert.CRLDistributionPoints, func(u string) bool {
		return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
	})
	// pdfsign asks online only for what the PDF doesn't carry.
	unanswered = online && (hasOCSP && !c.OCSPEmbedded && !c.OCSPExternal || hasCRL && !c.CRLEmbedded && !c.CRLExternal)
	switch {
	case unknown:
		return "unavailable", "The certificate authority doesn't know this certificate", unanswered
	// pdfsign never checks an embedded CRL's signature.
	case c.OCSPEmbedded || c.CRLEmbedded:
		return "not_checked", "Revocation data in the PDF couldn't be verified", unanswered
	case c.OCSPExternal:
		return "unavailable", "The certificate authority's answer couldn't be verified", unanswered
	case !online:
		return "not_checked", "Not checked (turned off in settings)", false
	case !hasCRL && !hasOCSP:
		return "not_checked", "Not checked: the revocation list is only on LDAP", false
	default:
		return "unavailable", "Couldn't reach the certificate authority's revocation service", unanswered
	}
}

// trustedRoots are the roots chains are checked against; nil is the system's.
var trustedRoots *x509.CertPool

// issuerOf is the certificate whose key signed cert: one the PDF carries, else
// a trusted root. Nil when neither is found.
func issuerOf(cert *x509.Certificate, certs []verify.Certificate, at time.Time) *x509.Certificate {
	pool := x509.NewCertPool()
	for _, c := range certs {
		if c.Certificate == nil {
			continue
		}
		if bytes.Equal(c.Certificate.RawSubject, cert.RawIssuer) && cert.CheckSignatureFrom(c.Certificate) == nil {
			return c.Certificate
		}
		pool.AddCert(c.Certificate)
	}
	chains, err := cert.Verify(x509.VerifyOptions{
		Roots: trustedRoots, Intermediates: pool, CurrentTime: at, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	if err != nil || len(chains[0]) < 2 {
		return nil
	}
	return chains[0][1]
}

// ocspSignedBy says whether issuer signed the OCSP answer, itself or through an
// OCSP responder certificate it issued (whose signature on the answer was
// checked when it was parsed).
func ocspSignedBy(resp *ocsp.Response, issuer *x509.Certificate) bool {
	if resp == nil || issuer == nil {
		return false
	}
	if resp.CheckSignatureFrom(issuer) == nil {
		return true
	}
	responder := resp.Certificate
	return responder != nil && slices.Contains(responder.ExtKeyUsage, x509.ExtKeyUsageOCSPSigning) &&
		responder.CheckSignatureFrom(issuer) == nil
}
