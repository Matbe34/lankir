package signature

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/verify"
	"golang.org/x/crypto/ocsp"
)

func TestVerifyOptionsFollowTheSetting(t *testing.T) {
	ctx := context.Background()
	for _, online := range []bool{true, false} {
		got := verifyOptions(ctx, online)
		want := verify.DefaultVerifyOptions() //nolint:staticcheck // SA1019: compared against the options API in use
		want.EnableExternalRevocationCheck = online
		want.HTTPTimeout = 10 * time.Second
		want.MaxCRLResponseBytes = 32 << 20
		want.Context = ctx
		if !reflect.DeepEqual(got, want) {
			t.Errorf("online=%v: options = %+v, want pdfsign's defaults with %+v", online, got, want)
		}
	}
}

// revocationTestChain is a signer under an intermediate under a root, each
// naming the revocation services real CAs do.
func revocationTestChain(t *testing.T) (signer, intermediate, root *x509.Certificate, interKey crypto.Signer) {
	t.Helper()
	ca := func(name string, parent *testCA, crl []string) *testCA {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		return &testCA{newTestCert(t, &x509.Certificate{
			SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: name},
			NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
			IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, CRLDistributionPoints: crl,
		}, key, parent), key}
	}
	rootCA := ca("AC RAIZ FNMT-RCM", nil, nil)
	interCA := ca("AC FNMT Usuarios", rootCA, []string{"http://crl.example/arl.crl"})
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer = newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "GARCIA LOPEZ MARIA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		OCSPServer: []string{"http://ocsp.example"}, CRLDistributionPoints: []string{"http://crl.example/1.crl"},
	}, key, interCA)
	return signer, interCA.cert, rootCA.cert, interCA.key
}

func TestRevocationOf(t *testing.T) {
	signerCert, interCert, rootCert, interKey := revocationTestChain(t)
	// What the intermediate's OCSP service answers online about the signer.
	answer := ocspGood(t, signerCert, &testCA{interCert, interKey})
	noURLs := &x509.Certificate{Subject: pkix.Name{CommonName: "Self"}, RawSubject: []byte("self"), RawIssuer: []byte("other")}
	ocspOnly := &x509.Certificate{
		Subject: pkix.Name{CommonName: "Signer"}, RawSubject: []byte("signer"), RawIssuer: []byte("inter"),
		OCSPServer: []string{"http://ocsp.example"},
	}
	ldap := []string{"ldap://ldap.example/cn=CRL1?certificateRevocationList;binary"}
	ocspLDAP := &x509.Certificate{
		Subject: pkix.Name{CommonName: "Signer"}, RawSubject: []byte("signer"), RawIssuer: []byte("inter"),
		OCSPServer: []string{"http://ocsp.example"}, CRLDistributionPoints: ldap,
	}
	ldapOnly := &x509.Certificate{Subject: pkix.Name{CommonName: "Signer"}, RawSubject: []byte("signer"), RawIssuer: []byte("inter"), CRLDistributionPoints: ldap}
	revoked := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	chain := func(signer, inter verify.Certificate) []verify.Certificate {
		signer.Certificate, inter.Certificate = signerCert, interCert
		return []verify.Certificate{signer, {Certificate: rootCert}, inter}
	}

	tests := []struct {
		name        string
		signer      verify.Signer
		online      bool
		status, msg string
	}{
		{
			name:   "OCSP answered online for the signer, CRL for the intermediate",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{OCSPResponse: answer, OCSPExternal: true}, verify.Certificate{CRLExternal: true})},
			online: true, status: "good", msg: "OCSP checked online with the certificate authority",
		},
		{
			name:   "CRL downloaded online",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{CRLExternal: true}, verify.Certificate{CRLExternal: true})},
			online: true, status: "good", msg: "CRL checked online with the certificate authority",
		},
		{
			name:   "OCSP and CRL both answered",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{OCSPResponse: answer, OCSPExternal: true, CRLExternal: true}, verify.Certificate{CRLExternal: true})},
			online: true, status: "good", msg: "OCSP and CRL checked online with the certificate authority",
		},
		{
			name:   "embedded in the PDF, online checks off",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{OCSPEmbedded: true}, verify.Certificate{CRLEmbedded: true})},
			online: false, status: "not_checked", msg: "Revocation data in the PDF couldn't be verified",
		},
		{
			name:   "only an embedded CRL, which pdfsign never checks",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{CRLEmbedded: true}, verify.Certificate{CRLExternal: true})},
			online: true, status: "not_checked", msg: "Revocation data in the PDF couldn't be verified",
		},
		{
			name:   "no answer from the certificate authority",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{}, verify.Certificate{})},
			online: true, status: "unavailable", msg: "Couldn't reach the certificate authority's revocation service",
		},
		{
			name:   "the signer answered, the intermediate did not",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{OCSPResponse: answer, OCSPExternal: true}, verify.Certificate{})},
			online: true, status: "unavailable",
			msg: "OCSP checked online with the certificate authority; AC FNMT Usuarios: couldn't reach the certificate authority's revocation service",
		},
		{
			name:   "turned off in settings",
			signer: verify.Signer{TrustedIssuer: true, Certificates: chain(verify.Certificate{}, verify.Certificate{})},
			online: false, status: "not_checked", msg: "Not checked (turned off in settings)",
		},
		{
			name:   "the certificate names no revocation service",
			signer: verify.Signer{Certificates: []verify.Certificate{{Certificate: noURLs}}},
			online: true, status: "not_checked", msg: "The certificate names no revocation service",
		},
		{
			name:   "OCSP only, under an issuer nobody trusts",
			signer: verify.Signer{Certificates: []verify.Certificate{{Certificate: ocspOnly}}},
			online: true, status: "not_checked", msg: "Not checked: the issuer isn't trusted",
		},
		{
			name:   "OCSP under an untrusted issuer, CRL only over LDAP",
			signer: verify.Signer{Certificates: []verify.Certificate{{Certificate: ocspLDAP}}},
			online: true, status: "not_checked", msg: "Not checked: the issuer isn't trusted",
		},
		{
			name:   "a revocation list only over LDAP",
			signer: verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{{Certificate: ldapOnly}}},
			online: true, status: "not_checked", msg: "Not checked: the revocation list is only on LDAP",
		},
		{
			name:   "an untrusted chain is never good, whatever was found",
			signer: verify.Signer{Certificates: chain(verify.Certificate{CRLExternal: true, OCSPEmbedded: true}, verify.Certificate{})},
			online: true, status: "not_checked", msg: "Not checked: the issuer isn't trusted",
		},
		{
			name: "revoked, found online",
			signer: verify.Signer{TrustedIssuer: true, RevokedCertificate: true,
				Certificates: chain(verify.Certificate{CRLExternal: true, RevocationTime: &revoked}, verify.Certificate{CRLExternal: true})},
			online: true, status: "revoked", msg: "CRL checked online with the certificate authority",
		},
		{
			name: "revoked after a trusted timestamp's signing time",
			signer: verify.Signer{TrustedIssuer: true, TimeSource: "embedded_timestamp",
				Certificates: chain(verify.Certificate{OCSPResponse: answer, OCSPExternal: true, RevocationTime: &revoked}, verify.Certificate{CRLExternal: true})},
			online: true, status: "revoked_later", msg: "Revoked on 30 Oct 2026, after the trusted signing time",
		},
		{
			name: "the intermediate revoked after a trusted timestamp's signing time",
			signer: verify.Signer{TrustedIssuer: true, TimeSource: "embedded_timestamp",
				Certificates: chain(verify.Certificate{OCSPResponse: answer, OCSPExternal: true}, verify.Certificate{CRLExternal: true, RevocationTime: &revoked})},
			online: true, status: "revoked_later", msg: "AC FNMT Usuarios: revoked on 30 Oct 2026, after the trusted signing time",
		},
		{
			name: "a later revocation in data nobody can check, under an untrusted issuer",
			signer: verify.Signer{TimeSource: "embedded_timestamp",
				Certificates: chain(verify.Certificate{CRLEmbedded: true, RevocationTime: &revoked}, verify.Certificate{})},
			online: true, status: "not_checked", msg: "Not checked: the issuer isn't trusted",
		},
		{
			name:   "no certificate",
			signer: verify.Signer{},
			online: true, status: "not_checked", msg: "Not checked",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, msg, _ := revocationOf(tt.signer, tt.online)
			if status != tt.status || msg != tt.msg {
				t.Errorf("revocationOf = %q, %q; want %q, %q", status, msg, tt.status, tt.msg)
			}
		})
	}
}

// signWithCRL signs a PDF with a certificate issued by ca, or self-signed
// without one, whose CRL lives at crlURL.
func signWithCRL(t *testing.T, crlURL string, ca *testCA) (pdf string, signer testSigner) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(42),
		Subject:               pkix.Name{CommonName: "Test Signer"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCRLSign,
		SubjectKeyId:          []byte{1, 2, 3, 4},
		CRLDistributionPoints: []string{crlURL},
	}
	signer = testSigner{key, newTestCert(t, tpl, key, ca)}
	pdf = filepath.Join(t.TempDir(), "signed.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(plainTestPDF(t), pdf, signer, &types.Certificate{Name: "Test Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}
	return pdf, signer
}

// crlServer serves the CRL stored in crl, or fails while failing is set, and counts requests.
func crlServer(t *testing.T) (srv *httptest.Server, hits *atomic.Int32, crl *atomic.Pointer[[]byte], failing *atomic.Bool) {
	t.Helper()
	hits, crl, failing = new(atomic.Int32), new(atomic.Pointer[[]byte]), new(atomic.Bool)
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if failing.Load() || crl.Load() == nil {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/pkix-crl")
		_, _ = w.Write(*crl.Load())
	}))
	t.Cleanup(srv.Close)
	return srv, hits, crl, failing
}

// verifyWith verifies pdf with a fresh service whose setting is online.
func verifyWith(t *testing.T, pdf string, online bool) types.SignatureInfo {
	t.Helper()
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Get()
	c.CheckRevocationOnline = online
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	sigs, err := NewSignatureService(cfg).VerifySignatures(pdf)
	if err != nil || len(sigs) != 1 {
		t.Fatalf("VerifySignatures = %v, %v; want one signature", sigs, err)
	}
	return sigs[0]
}

func TestVerifySignaturesAsksTheCertificateAuthority(t *testing.T) {
	srv, hits, crl, failing := crlServer(t)
	root := testCAUnder(t, "Test Root", nil)
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()

	pdf, signer := signWithCRL(t, srv.URL+"/test.crl", root)
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number:     big.NewInt(1),
		ThisUpdate: time.Now().Add(-time.Minute),
		NextUpdate: time.Now().Add(time.Hour),
		RevokedCertificateEntries: []x509.RevocationListEntry{
			{SerialNumber: signer.cert.SerialNumber, RevocationTime: time.Now().Add(-30 * time.Minute)},
		},
	}, root.cert, root.key)
	if err != nil {
		t.Fatal(err)
	}
	crl.Store(&der)

	sig := verifyWith(t, pdf, false)
	if hits.Load() != 0 {
		t.Fatalf("setting off: the CRL server was asked %d times", hits.Load())
	}
	if sig.RevocationStatus != "not_checked" || sig.RevocationCheck != "Not checked (turned off in settings)" {
		t.Errorf("setting off: revocation = %q %q", sig.RevocationStatus, sig.RevocationCheck)
	}

	sig = verifyWith(t, pdf, true)
	if hits.Load() == 0 {
		t.Fatal("setting on: the CRL server was never asked")
	}
	if sig.RevocationStatus != "revoked" || sig.RevocationCheck != "CRL checked online with the certificate authority" || sig.CertificateValid {
		t.Errorf("setting on: revocation = %q %q, certificate valid %v; want revoked, found online", sig.RevocationStatus, sig.RevocationCheck, sig.CertificateValid)
	}

	failing.Store(true)
	sig = verifyWith(t, pdf, true)
	if sig.RevocationStatus != "unavailable" || sig.RevocationCheck != "Couldn't reach the certificate authority's revocation service" {
		t.Errorf("server down: revocation = %q %q", sig.RevocationStatus, sig.RevocationCheck)
	}
}

// testCAUnder makes a CA certificate signed by parent, or self-signed without one.
func testCAUnder(t *testing.T, name string, parent *testCA) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}, key, parent)
	return &testCA{cert, key}
}

// ocspGood is a "good" OCSP answer about cert, signed by signer's key.
func ocspGood(t *testing.T, cert *x509.Certificate, signer *testCA) *ocsp.Response {
	t.Helper()
	der, err := ocsp.CreateResponse(signer.cert, signer.cert, ocsp.Response{
		Status: ocsp.Good, SerialNumber: cert.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
	}, signer.key)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := ocsp.ParseResponse(der, nil)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestEmbeddedOCSPCountsOnlyWhenTheIssuerSignedIt(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	// Same name as the intermediate, another key: what a forger would embed.
	forger := testCAUnder(t, "Intermediate", root)

	signer := func(resp *ocsp.Response) verify.Signer {
		return verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{
			{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: resp}, {Certificate: forger.cert}, {Certificate: inter.cert},
		}}
	}
	status, msg, _ := revocationOf(signer(ocspGood(t, leaf, inter)), false)
	if status != "good" || msg != "Embedded in the PDF" {
		t.Errorf("signed by the issuer: revocationOf = %q, %q; want good, embedded", status, msg)
	}
	status, msg, _ = revocationOf(signer(ocspGood(t, leaf, forger)), false)
	if status != "not_checked" || msg != "Revocation data in the PDF couldn't be verified" {
		t.Errorf("signed by another key: revocationOf = %q, %q; want not checked, unverified", status, msg)
	}

	// Any certificate the issuer signed, the signer's own included, is not an OCSP responder.
	self := testCAUnder(t, "Signer", inter)
	der, err := ocsp.CreateResponse(inter.cert, self.cert, ocsp.Response{
		Status: ocsp.Good, SerialNumber: self.cert.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), Certificate: self.cert,
	}, self.key)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := ocsp.ParseResponse(der, nil)
	if err != nil {
		t.Fatal(err)
	}
	selfSigned := verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{
		{Certificate: self.cert, OCSPEmbedded: true, OCSPResponse: resp}, {Certificate: inter.cert},
	}}
	if status, msg, _ = revocationOf(selfSigned, false); status != "not_checked" {
		t.Errorf("answered by the signer's own certificate: revocationOf = %q, %q; want not checked", status, msg)
	}
}

func TestEmbeddedOCSPIssuerFromTheTrustedRoots(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()

	// The PDF carries the intermediate but not the root that signed its OCSP answer.
	signer := verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{
		{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: ocspGood(t, leaf, inter)},
		{Certificate: inter.cert, OCSPEmbedded: true, OCSPResponse: ocspGood(t, inter.cert, root)},
	}}
	if status, msg, _ := revocationOf(signer, false); status != "good" || msg != "Embedded in the PDF" {
		t.Errorf("revocationOf = %q, %q; want good, embedded", status, msg)
	}
}

func TestVerifySignaturesAsksOnlyAboutATrustedChain(t *testing.T) {
	srv, hits, _, _ := crlServer(t)
	pdf, _ := signWithCRL(t, srv.URL+"/test.crl", nil)

	sig := verifyWith(t, pdf, true)
	if hits.Load() != 0 {
		t.Errorf("untrusted signer: the URL the PDF names was fetched %d times", hits.Load())
	}
	if sig.RevocationStatus != "not_checked" || sig.RevocationCheck != "Not checked: the issuer isn't trusted" {
		t.Errorf("untrusted signer: revocation = %q %q", sig.RevocationStatus, sig.RevocationCheck)
	}
}

func TestVerifySignaturesKeepsTheAnswerForAnUnchangedFile(t *testing.T) {
	calls := 0
	verifyPDF = func(*SignatureService, string, bool) ([]types.SignatureInfo, bool, error) {
		calls++
		return []types.SignatureInfo{{SignerName: "Signer"}}, false, nil
	}
	defer func() { verifyPDF = (*SignatureService).verifyPDF }()

	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)
	dir := t.TempDir()
	pdf := filepath.Join(dir, "a.pdf")
	if err := os.WriteFile(pdf, []byte("%PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	check := func(what string, want int) {
		t.Helper()
		if _, err := svc.VerifySignatures(pdf); err != nil {
			t.Fatal(err)
		}
		if calls != want {
			t.Errorf("%s: verified %d times, want %d", what, calls, want)
		}
	}

	check("first look", 1)
	check("same file again", 1)
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(pdf, later, later); err != nil {
		t.Fatal(err)
	}
	check("saved since", 2)
	c := cfg.Get()
	c.CheckRevocationOnline = !c.CheckRevocationOnline
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	check("setting switched", 3)
	for k, e := range svc.verified {
		e.at = e.at.Add(-11 * time.Minute)
		svc.verified[k] = e
	}
	check("ten minutes on", 4)

	for i := range 40 {
		other := filepath.Join(dir, fmt.Sprintf("%d.pdf", i))
		if err := os.WriteFile(other, []byte("%PDF"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.VerifySignatures(other); err != nil {
			t.Fatal(err)
		}
	}
	if len(svc.verified) > 32 {
		t.Errorf("kept %d answers, want at most 32", len(svc.verified))
	}
}

func TestVerifySignaturesAsksAgainAfterTheAuthorityWasUnreachable(t *testing.T) {
	srv, _, crl, failing := crlServer(t)
	root := testCAUnder(t, "Test Root", nil)
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()
	pdf, _ := signWithCRL(t, srv.URL+"/test.crl", root)
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number: big.NewInt(1), ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
	}, root.cert, root.key)
	if err != nil {
		t.Fatal(err)
	}
	crl.Store(&der)
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)

	failing.Store(true)
	if sigs, err := svc.VerifySignatures(pdf); err != nil || sigs[0].RevocationStatus != "unavailable" {
		t.Fatalf("network down: %v, %v; want unavailable", sigs, err)
	}
	failing.Store(false)
	sigs, err := svc.VerifySignatures(pdf)
	if err != nil || sigs[0].RevocationStatus != "good" {
		t.Errorf("network back: revocation = %q %q, %v; want good", sigs[0].RevocationStatus, sigs[0].RevocationCheck, err)
	}
}

func TestAForgedIssuerNameDoesNotReplaceTheIntermediate(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	// Self-signed, with the intermediate's name, placed ahead of it in the PDF.
	forgery := testCAUnder(t, "Intermediate", nil).cert
	interCRL := *inter.cert
	interCRL.CRLDistributionPoints = []string{"http://crl.example/x.crl"}
	revokedAt := time.Now().Add(-time.Minute)

	for _, tt := range []struct {
		name  string
		inter verify.Certificate
		ts    string
	}{
		{"intermediate revoked after the timestamp", verify.Certificate{Certificate: inter.cert, RevocationTime: &revokedAt}, "embedded_timestamp"},
		{"intermediate not checked", verify.Certificate{Certificate: &interCRL}, ""},
	} {
		signer := func(certs ...verify.Certificate) verify.Signer {
			leafCert := verify.Certificate{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: ocspGood(t, leaf, inter)}
			return verify.Signer{TrustedIssuer: true, TimeSource: tt.ts, Certificates: append([]verify.Certificate{leafCert}, certs...)}
		}
		wantStatus, wantMsg, _ := revocationOf(signer(tt.inter), false)
		status, msg, _ := revocationOf(signer(verify.Certificate{Certificate: forgery}, tt.inter), false)
		if status != wantStatus || msg != wantMsg || status == "good" {
			t.Errorf("%s, forgery ahead: revocationOf = %q, %q; want %q, %q", tt.name, status, msg, wantStatus, wantMsg)
		}
		chain := chainOf(signer(verify.Certificate{Certificate: forgery}, tt.inter).Certificates)
		if len(chain) < 2 || chain[1].Subject != "Intermediate" || chain[1].Issuer != "Root" {
			t.Errorf("%s: chain = %+v, want the real intermediate under Root", tt.name, chain)
		}
	}
}

func TestOnlineOCSPCountsOnlyFromTheIssuerOrItsResponder(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()

	// Another certificate the same CA issued, with no OCSP Signing EKU: anyone's.
	sibKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	sib := &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(5), Subject: pkix.Name{CommonName: "Some other citizen"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}, sibKey, root), sibKey}

	var leaf *x509.Certificate
	var answerer atomic.Pointer[testCA]
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		by := answerer.Load()
		der, err := ocsp.CreateResponse(root.cert, by.cert, ocsp.Response{
			Status: ocsp.Good, SerialNumber: leaf.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour), Certificate: by.cert,
		}, by.key)
		if err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/ocsp-response")
		_, _ = w.Write(der)
	}))
	defer srv.Close()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	leaf = newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, SubjectKeyId: []byte{1, 2, 3}, OCSPServer: []string{srv.URL},
	}, key, root)
	pdf := filepath.Join(t.TempDir(), "signed.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(plainTestPDF(t), pdf, testSigner{key, leaf}, &types.Certificate{Name: "Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}

	answerer.Store(root)
	if sig := verifyWith(t, pdf, true); sig.RevocationStatus != "good" || sig.RevocationCheck != "OCSP checked online with the certificate authority" {
		t.Errorf("answered by the issuer: revocation = %q %q, want good", sig.RevocationStatus, sig.RevocationCheck)
	}
	answerer.Store(sib)
	if sig := verifyWith(t, pdf, true); sig.RevocationStatus != "unavailable" || sig.RevocationCheck != "The certificate authority's answer couldn't be verified" {
		t.Errorf("answered by a sibling certificate: revocation = %q %q, want unavailable, unverified", sig.RevocationStatus, sig.RevocationCheck)
	}

	// An answer that fails the check fails it again: kept like any other.
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)
	for range 2 {
		if _, err := svc.VerifySignatures(pdf); err != nil {
			t.Fatal(err)
		}
	}
	before := hits.Load()
	if _, err := svc.VerifySignatures(pdf); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != before {
		t.Errorf("an unverifiable answer was asked for again: %d more requests", hits.Load()-before)
	}
}

func TestOnlinePassAsksOnlyHostsATrustedCertificateNames(t *testing.T) {
	tracker, trackerHits, _, _ := crlServer(t)
	var trustedHits atomic.Int32
	// The trusted CA's own server, sending the request on to the tracker.
	trusted := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trustedHits.Add(1)
		http.Redirect(w, r, tracker.URL+"/via-redirect.crl", http.StatusFound)
	}))
	defer trusted.Close()
	root := testCAUnder(t, "Test Root", nil)
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()

	first, _ := signWithCRL(t, trusted.URL+"/ca.crl", root)
	// A second, self-signed signature whose CRL URL is the tracker's.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tracked := testSigner{key, newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(77), Subject: pkix.Name{CommonName: "Tracker"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, SubjectKeyId: []byte{9, 9, 9},
		CRLDistributionPoints: []string{tracker.URL + "/track.crl"},
	}, key, nil)}
	pdf := filepath.Join(t.TempDir(), "twice.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(first, pdf, tracked, &types.Certificate{Name: "Tracker"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sigs, err := NewSignatureService(cfg).VerifySignatures(pdf)
	if err != nil || len(sigs) != 2 {
		t.Fatalf("VerifySignatures = %v, %v; want two signatures", sigs, err)
	}
	if trustedHits.Load() == 0 {
		t.Error("the trusted certificate's CRL server was never asked")
	}
	if trackerHits.Load() != 0 {
		t.Errorf("a host no trusted certificate names was asked %d times", trackerHits.Load())
	}
}

type chainSigner struct {
	testSigner
	cas []*x509.Certificate
}

func (s chainSigner) CACertificates() []*x509.Certificate { return s.cas }

// sameKeyForgery has the intermediate's name and public key, issued by evil.
func sameKeyForgery(t *testing.T, inter, evil *testCA, crl []string) *x509.Certificate {
	t.Helper()
	return newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(999), Subject: inter.cert.Subject,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
		CRLDistributionPoints: crl,
	}, inter.key /* only its Public() is used */, evil)
}

func TestASameKeyForgeryDoesNotReplaceTheIntermediate(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	evil := testCAUnder(t, "Evil Root", nil)
	evilWithURL := *evil.cert
	evilWithURL.CRLDistributionPoints = []string{"http://tracker.evil/x.crl"}
	interCRL := *inter.cert
	interCRL.CRLDistributionPoints = []string{"http://crl.example/x.crl"}

	leafCert := verify.Certificate{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: ocspGood(t, leaf, inter)}
	honest := verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{leafCert, {Certificate: &interCRL}}}
	// pdfsign marks each certificate that doesn't chain to a trusted root.
	forged := verify.Signer{TrustedIssuer: true, Certificates: []verify.Certificate{
		leafCert,
		{Certificate: sameKeyForgery(t, inter, evil, nil), VerifyError: "x509: certificate signed by unknown authority"},
		{Certificate: &evilWithURL, VerifyError: "x509: certificate signed by unknown authority"},
		{Certificate: &interCRL},
	}}
	wantStatus, wantMsg, _ := revocationOf(honest, false)
	if status, msg, _ := revocationOf(forged, false); status != wantStatus || msg != wantMsg {
		t.Errorf("revocationOf = %q, %q; want %q, %q", status, msg, wantStatus, wantMsg)
	}
	if chain := chainOf(forged.Certificates); !reflect.DeepEqual(chain, chainOf(honest.Certificates)) {
		t.Errorf("chain = %+v, want %+v", chain, chainOf(honest.Certificates))
	}
	if hosts := revocationHosts(&verify.Response{Signers: []verify.Signer{forged}}); hosts["tracker.evil"] {
		t.Errorf("hosts = %v, want none of the forgery's", hosts)
	}
}

func TestOnlinePassIgnoresAForgedIntermediateSpliced(t *testing.T) {
	tracker, trackerHits, _, _ := crlServer(t)
	root := testCAUnder(t, "Test Root", nil)
	roots := x509.NewCertPool()
	roots.AddCert(root.cert)
	trustedRoots = roots
	defer func() { trustedRoots = nil }()

	var leafCRL atomic.Pointer[[]byte]
	ca := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/leaf.crl" && leafCRL.Load() != nil {
			w.Header().Set("Content-Type", "application/pkix-crl")
			_, _ = w.Write(*leafCRL.Load())
			return
		}
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer ca.Close()
	// The real intermediate names a CRL that can't be fetched now.
	interKey := testCAUnder(t, "Test Intermediate", root)
	inter := &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(7), Subject: interKey.cert.Subject,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		CRLDistributionPoints: []string{ca.URL + "/inter.crl"},
	}, interKey.key, root), interKey.key}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	leaf := newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, SubjectKeyId: []byte{1, 2, 3},
		CRLDistributionPoints: []string{ca.URL + "/leaf.crl"},
	}, key, inter)
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number: big.NewInt(1), ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
	}, inter.cert, inter.key)
	if err != nil {
		t.Fatal(err)
	}
	leafCRL.Store(&der)

	// An evil root naming the tracker, and the intermediate's name and key under it.
	evilKey := testCAUnder(t, "Evil Root", nil)
	trackerURL, err := url.Parse(tracker.URL)
	if err != nil {
		t.Fatal(err)
	}
	evil := &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(5), Subject: evilKey.cert.Subject,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
		CRLDistributionPoints: []string{"http://" + trackerURL.Host + "/evil.crl"},
	}, evilKey.key, nil), evilKey.key}

	pdf := filepath.Join(t.TempDir(), "signed.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(plainTestPDF(t), pdf, chainSigner{testSigner{key, leaf}, []*x509.Certificate{inter.cert}}, &types.Certificate{Name: "Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}
	injectCerts(t, pdf, []*x509.Certificate{sameKeyForgery(t, inter, evil, nil), evil.cert})
	// A second, untrusted signature whose CRL is on the forged root's host.
	trackedKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tracked := testSigner{trackedKey, newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(77), Subject: pkix.Name{CommonName: "Tracker"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, SubjectKeyId: []byte{9, 9, 9},
		CRLDistributionPoints: []string{tracker.URL + "/track.crl"},
	}, trackedKey, nil)}
	twice := filepath.Join(t.TempDir(), "twice.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(pdf, twice, tracked, &types.Certificate{Name: "Tracker"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sigs, err := NewSignatureService(cfg).VerifySignatures(twice)
	if err != nil || len(sigs) != 2 {
		t.Fatalf("VerifySignatures = %v, %v; want two signatures", sigs, err)
	}
	sig := sigs[0]
	if sig.SignerName != "Signer" {
		sig = sigs[1]
	}
	if trackerHits.Load() != 0 {
		t.Errorf("the forged root's host was asked %d times", trackerHits.Load())
	}
	if sig.RevocationStatus != "unavailable" {
		t.Errorf("revocation = %q %q, want unavailable: the real intermediate's CRL is down", sig.RevocationStatus, sig.RevocationCheck)
	}
	if want := []types.ChainCertificate{{Subject: "Signer", Issuer: "Test Intermediate"}, {Subject: "Test Intermediate", Issuer: "Test Root"}}; !reflect.DeepEqual(sig.Chain, want) {
		t.Errorf("chain = %+v, want %+v", sig.Chain, want)
	}
}

// injectCerts puts extra certificates at the front of the first signature's
// CMS certificate set, outside what the signature covers.
func injectCerts(t *testing.T, pdf string, extra []*x509.Certificate) {
	t.Helper()
	data, err := os.ReadFile(pdf)
	if err != nil {
		t.Fatal(err)
	}
	i := bytes.Index(data, []byte("/Contents<"))
	if i < 0 {
		t.Fatal("no /Contents")
	}
	start := i + len("/Contents<")
	end := start + bytes.IndexByte(data[start:], '>')
	raw, err := hex.DecodeString(string(data[start:end]))
	if err != nil {
		t.Fatal(err)
	}
	type contentInfo struct {
		ContentType asn1.ObjectIdentifier
		Content     asn1.RawValue `asn1:"explicit,tag:0"`
	}
	var ci contentInfo
	if _, err := asn1.Unmarshal(raw, &ci); err != nil {
		t.Fatal(err)
	}
	// Walk SignedData's fields.
	var seq asn1.RawValue
	if _, err := asn1.Unmarshal(ci.Content.Bytes, &seq); err != nil {
		t.Fatal(err)
	}
	rest := seq.Bytes
	var fields []asn1.RawValue
	for len(rest) > 0 {
		var f asn1.RawValue
		rest, err = asn1.Unmarshal(rest, &f)
		if err != nil {
			t.Fatal(err)
		}
		fields = append(fields, f)
	}
	var body []byte
	done := false
	for _, f := range fields {
		if !done && f.Class == asn1.ClassContextSpecific && f.Tag == 0 {
			var prefix []byte
			for _, c := range extra {
				prefix = append(prefix, c.Raw...)
			}
			f = asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: append(prefix, f.Bytes...)}
			done = true
		}
		b, err := asn1.Marshal(f)
		if err != nil {
			t.Fatal(err)
		}
		body = append(body, b...)
	}
	if !done {
		t.Fatal("no certificates field")
	}
	sd, err := asn1.Marshal(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: body})
	if err != nil {
		t.Fatal(err)
	}
	out, err := asn1.Marshal(contentInfo{ci.ContentType, asn1.RawValue{FullBytes: mustExplicit(t, sd)}})
	if err != nil {
		t.Fatal(err)
	}
	h := []byte(hex.EncodeToString(out))
	if len(h) > end-start {
		t.Fatalf("injected CMS %d hex chars, room for %d", len(h), end-start)
	}
	padded := append(h, bytes.Repeat([]byte("0"), end-start-len(h))...)
	copy(data[start:end], padded)
	if err := os.WriteFile(pdf, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustExplicit(t *testing.T, inner []byte) []byte {
	b, err := asn1.Marshal(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: inner})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// ocspAnswer is an OCSP answer about cert with status, signed by signer's key.
func ocspAnswer(t *testing.T, cert *x509.Certificate, signer *testCA, status int) []byte {
	t.Helper()
	der, err := ocsp.CreateResponse(signer.cert, signer.cert, ocsp.Response{
		Status: status, SerialNumber: cert.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
		RevokedAt: time.Now().Add(-30 * time.Minute).Truncate(time.Second),
	}, signer.key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

// ocspServer answers every OCSP request with what answer returns, and counts them.
func ocspServer(t *testing.T, answer func() []byte) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	hits := new(atomic.Int32)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/ocsp-response")
		_, _ = w.Write(answer())
	}))
	t.Cleanup(srv.Close)
	return srv, hits
}

// newLeaf is a signing certificate under ca naming these OCSP and CRL URLs, and its key.
func newLeaf(t *testing.T, ca *testCA, ocspURL, crlURL string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, SubjectKeyId: []byte{1, 2, 3},
	}
	if ocspURL != "" {
		tpl.OCSPServer = []string{ocspURL}
	}
	if crlURL != "" {
		tpl.CRLDistributionPoints = []string{crlURL}
	}
	return newTestCert(t, tpl, key, ca), key
}

// signedLeaf signs a PDF with a new certificate under ca naming these OCSP and CRL URLs.
func signedLeaf(t *testing.T, ca *testCA, ocspURL, crlURL string) (pdf string, leaf *x509.Certificate) {
	t.Helper()
	leaf, key := newLeaf(t, ca, ocspURL, crlURL)
	pdf = filepath.Join(t.TempDir(), "signed.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(plainTestPDF(t), pdf, testSigner{key, leaf}, &types.Certificate{Name: "Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatal(err)
	}
	return pdf, leaf
}

// trustRoot makes ca the only trusted root for the test.
func trustRoot(t *testing.T, ca *testCA) {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(ca.cert)
	trustedRoots = roots
	t.Cleanup(func() { trustedRoots = nil })
}

// emptyCRL is a current CRL from ca listing these revoked certificates.
func emptyCRL(t *testing.T, ca *testCA, revoked ...x509.RevocationListEntry) []byte {
	t.Helper()
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number: big.NewInt(1), ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
		RevokedCertificateEntries: revoked,
	}, ca.cert, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

func TestAnUnknownOCSPAnswerIsNotARevocation(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	trustRoot(t, root)
	var leaf atomic.Pointer[x509.Certificate]
	srv, _ := ocspServer(t, func() []byte { return ocspAnswer(t, leaf.Load(), root, ocsp.Unknown) })
	pdf, cert := signedLeaf(t, root, srv.URL, "")
	leaf.Store(cert)

	sig := verifyWith(t, pdf, true)
	if sig.RevocationStatus != "unavailable" || sig.RevocationCheck != "The certificate authority doesn't know this certificate" {
		t.Errorf("revocation = %q %q; want unavailable, unknown to the CA", sig.RevocationStatus, sig.RevocationCheck)
	}
	if !sig.CertificateValid || sig.CertificateValidationMessage != "Certificate is valid and trusted" {
		t.Errorf("certificate valid %v, %q; want valid and trusted", sig.CertificateValid, sig.CertificateValidationMessage)
	}
	for _, w := range sig.Warnings {
		if strings.Contains(strings.ToLower(w), "revoked") {
			t.Errorf("warning %q calls the certificate revoked", w)
		}
	}
}

func TestAnUnknownOCSPAnswerEmbeddedIsNotARevocation(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	resp, err := ocsp.ParseResponse(ocspAnswer(t, leaf, inter, ocsp.Unknown), nil)
	if err != nil {
		t.Fatal(err)
	}
	// What pdfsign reports for it: revoked at the zero time.
	zero := resp.RevokedAt
	signer := verify.Signer{TrustedIssuer: true, RevokedCertificate: true, Certificates: []verify.Certificate{
		{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: resp, RevocationTime: &zero, RevokedBeforeSigning: true}, {Certificate: inter.cert},
	}}
	if status, msg, _ := revocationOf(signer, false); status != "unavailable" || msg != "The certificate authority doesn't know this certificate" {
		t.Errorf("revocationOf = %q, %q; want unavailable, unknown to the CA", status, msg)
	}
	if info, _ := NewSignatureService(nil).convertSignerToInfo(signer, "", false); !info.CertificateValid || info.RevocationStatus == "revoked" {
		t.Errorf("certificate valid %v, revocation %q; want valid, not revoked", info.CertificateValid, info.RevocationStatus)
	}

	// Revoked in a CRL too: that is a revocation.
	crlAt := time.Now().Add(-time.Hour)
	signer.Certificates[0].CRLEmbedded, signer.Certificates[0].RevocationTime = true, &crlAt
	if status, _, _ := revocationOf(signer, false); status != "revoked" {
		t.Errorf("unknown to OCSP, revoked in the CRL: revocationOf = %q, want revoked", status)
	}
}

// Round 4: an online OCSP answer that fails the check and a CRL the network
// didn't deliver; the CRL may come the next time.
func TestVerifySignaturesAsksAgainAfterACRLWentUnanswered(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	trustRoot(t, root)
	sibKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	// Another certificate the CA issued, without the OCSP Signing EKU.
	sib := &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(5), Subject: pkix.Name{CommonName: "Some other citizen"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature,
	}, sibKey, root), sibKey}
	var leaf atomic.Pointer[x509.Certificate]
	ocspSrv, _ := ocspServer(t, func() []byte {
		der, err := ocsp.CreateResponse(root.cert, sib.cert, ocsp.Response{
			Status: ocsp.Good, SerialNumber: leaf.Load().SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour), Certificate: sib.cert,
		}, sib.key)
		if err != nil {
			t.Error(err)
		}
		return der
	})
	crlSrv, _, crl, failing := crlServer(t)
	pdf, cert := signedLeaf(t, root, ocspSrv.URL, crlSrv.URL+"/ca.crl")
	leaf.Store(cert)
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)

	failing.Store(true)
	sigs, err := svc.VerifySignatures(pdf)
	if err != nil || sigs[0].RevocationStatus != "unavailable" {
		t.Fatalf("CRL down: %v, %v; want unavailable", sigs, err)
	}
	der := emptyCRL(t, root)
	crl.Store(&der)
	failing.Store(false)
	sigs, err = svc.VerifySignatures(pdf)
	if err != nil || sigs[0].RevocationStatus != "good" || sigs[0].RevocationCheck != "CRL checked online with the certificate authority" {
		t.Errorf("CRL back: revocation = %q %q, %v; want good from the CRL", sigs[0].RevocationStatus, sigs[0].RevocationCheck, err)
	}
}

// An OCSP "unknown" on top of a CRL revocation after a trusted signing time
// reads the same as that revocation alone.
func TestAnUnknownOCSPAnswerKeepsARevocationAfterSigning(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	resp, err := ocsp.ParseResponse(ocspAnswer(t, leaf, inter, ocsp.Unknown), nil)
	if err != nil {
		t.Fatal(err)
	}
	signed := time.Now().Add(-2 * time.Hour)
	crlAt := time.Now().Add(-time.Hour)
	signer := verify.Signer{
		TrustedIssuer: true, RevokedCertificate: true, // set by the unknown
		TimeSource: "embedded_timestamp", TimestampStatus: "valid", TimestampTrusted: true, VerificationTime: &signed,
		Certificates: []verify.Certificate{
			{Certificate: leaf, OCSPExternal: true, OCSPResponse: resp, CRLExternal: true, RevocationTime: &crlAt},
			{Certificate: inter.cert},
		},
	}
	info, _ := NewSignatureService(nil).convertSignerToInfo(signer, "", true)
	if info.RevocationStatus != "revoked_later" || !info.CertificateValid {
		t.Errorf("revocation %q, certificate valid %v; want revoked_later, valid", info.RevocationStatus, info.CertificateValid)
	}

	// Revoked before signing in the CRL: revoked.
	before := signed.Add(-time.Hour)
	signer.Certificates[0].RevocationTime = &before
	if info, _ := NewSignatureService(nil).convertSignerToInfo(signer, "", true); info.RevocationStatus != "revoked" || info.CertificateValid {
		t.Errorf("revoked before signing: revocation %q, certificate valid %v; want revoked, not valid", info.RevocationStatus, info.CertificateValid)
	}
}

// A revoked intermediate above a signer only "unknown" to OCSP: the message
// has no zero date for the signer.
func TestRevokedMessageHasNoDateFromAnUnknownOCSPAnswer(t *testing.T) {
	root := testCAUnder(t, "Root", nil)
	inter := testCAUnder(t, "Intermediate", root)
	leaf := testCAUnder(t, "Signer", inter).cert
	resp, err := ocsp.ParseResponse(ocspAnswer(t, leaf, inter, ocsp.Unknown), nil)
	if err != nil {
		t.Fatal(err)
	}
	zero := resp.RevokedAt
	interAt := time.Now().Add(-time.Hour)
	signer := verify.Signer{TrustedIssuer: true, RevokedCertificate: true, Certificates: []verify.Certificate{
		{Certificate: leaf, OCSPEmbedded: true, OCSPResponse: resp, RevocationTime: &zero, RevokedBeforeSigning: true},
		{Certificate: inter.cert, CRLEmbedded: true, RevocationTime: &interAt, RevokedBeforeSigning: true},
	}}
	info, _ := NewSignatureService(nil).convertSignerToInfo(signer, "", false)
	if info.RevocationStatus != "revoked" || info.CertificateValidationMessage != "Certificate has been revoked" {
		t.Errorf("revocation %q, message %q; want revoked, no date for the signer", info.RevocationStatus, info.CertificateValidationMessage)
	}
}

// An offline check says so, not that the setting is off, and leaves the
// setting's own text alone for the same file.
func TestVerifySignaturesOfflineSaysItIsOffline(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	trustRoot(t, root)
	srv := newSwitchable(t)
	pdf, _ := signedLeaf(t, root, "", srv.URL+"/ca.crl")
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewSignatureService(cfg)
	sigs, err := service.VerifySignaturesOffline(pdf)
	if err != nil || len(sigs) != 1 {
		t.Fatalf("VerifySignaturesOffline = %v, %v; want one signature", sigs, err)
	}
	if sigs[0].RevocationStatus != "not_checked" || sigs[0].RevocationCheck != "Not checked online (offline check)" || srv.hits.Load() != 0 {
		t.Errorf("offline: revocation %q %q, %d requests; want not checked offline, none", sigs[0].RevocationStatus, sigs[0].RevocationCheck, srv.hits.Load())
	}

	c := cfg.Get()
	c.CheckRevocationOnline = false
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	if sigs, err = service.VerifySignatures(pdf); err != nil || sigs[0].RevocationCheck != "Not checked (turned off in settings)" {
		t.Errorf("setting off after an offline check: %v, %v; want turned off in settings", sigs, err)
	}
}
