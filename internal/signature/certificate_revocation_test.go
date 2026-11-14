package signature

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/signature/certutil"
	"golang.org/x/crypto/ocsp"
	goPkcs12 "software.sslmate.com/src/go-pkcs12"
)

// switchable serves what handler says, or fails while down is set, and counts requests.
type switchable struct {
	*httptest.Server
	hits    atomic.Int32
	down    atomic.Bool
	handler atomic.Pointer[func() []byte]
}

func newSwitchable(t *testing.T) *switchable {
	t.Helper()
	s := &switchable{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.hits.Add(1)
		answer := s.handler.Load()
		if s.down.Load() || answer == nil {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write((*answer)())
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *switchable) serve(answer func() []byte) { s.handler.Store(&answer) }

// ocspResponder is a certificate the CA issued to sign OCSP answers for it.
func ocspResponder(t *testing.T, ca *testCA, eku []x509.ExtKeyUsage) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "OCSP responder"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: eku,
	}, key, ca), key}
}

// delegatedAnswer is an OCSP answer about cert signed by a responder ca issued.
func delegatedAnswer(t *testing.T, cert *x509.Certificate, ca, responder *testCA, status int) []byte {
	t.Helper()
	der, err := ocsp.CreateResponse(ca.cert, responder.cert, ocsp.Response{
		Status: status, SerialNumber: cert.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour), Certificate: responder.cert,
	}, responder.key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

func TestCheckRevocation(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	inter := testCAUnder(t, "Test Intermediate", root)
	revokedAt := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name string
		// Set up the two servers for leaf.
		setup                  func(t *testing.T, leaf *x509.Certificate, ocspSrv, crlSrv *switchable)
		status, check, revoked string
		unanswered, crlAsked   bool
	}{
		{
			name: "OCSP says good: the CRL isn't asked",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.serve(func() []byte { return ocspAnswer(t, leaf, inter, ocsp.Good) })
			},
			status: "good", check: "OCSP checked online with the certificate authority",
		},
		{
			name: "OCSP says revoked",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.serve(func() []byte {
					der, err := ocsp.CreateResponse(inter.cert, inter.cert, ocsp.Response{
						Status: ocsp.Revoked, SerialNumber: leaf.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), RevokedAt: revokedAt,
					}, inter.key)
					if err != nil {
						t.Error(err)
					}
					return der
				})
			},
			status: "revoked", check: "OCSP checked online with the certificate authority", revoked: "2026-10-30T12:00:00Z",
		},
		{
			name: "a delegated OCSP responder says good",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				responder := ocspResponder(t, inter, []x509.ExtKeyUsage{x509.ExtKeyUsageOCSPSigning})
				o.serve(func() []byte { return delegatedAnswer(t, leaf, inter, responder, ocsp.Good) })
			},
			status: "good", check: "OCSP checked online with the certificate authority",
		},
		{
			name: "OCSP down, the CRL lists it",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				crl := emptyCRL(t, inter, x509.RevocationListEntry{SerialNumber: leaf.SerialNumber, RevocationTime: revokedAt})
				c.serve(func() []byte { return crl })
			},
			status: "revoked", check: "CRL checked online with the certificate authority", revoked: "2026-10-30T12:00:00Z", crlAsked: true,
		},
		{
			name: "OCSP down, the CRL doesn't list it",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				crl := emptyCRL(t, inter)
				c.serve(func() []byte { return crl })
			},
			status: "good", check: "CRL checked online with the certificate authority", crlAsked: true,
		},
		{
			name: "a CRL another CA signed doesn't count",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				crl := emptyCRL(t, testCAUnder(t, "Test Intermediate", root))
				c.serve(func() []byte { return crl })
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
		{
			name: "both down",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				c.down.Store(true)
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
		{
			name: "OCSP doesn't know it, the CRL is down",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.serve(func() []byte { return ocspAnswer(t, leaf, inter, ocsp.Unknown) })
				c.down.Store(true)
			},
			status: "unavailable", check: "The certificate authority doesn't know this certificate", unanswered: true, crlAsked: true,
		},
		{
			name: "OCSP answered by a certificate that isn't a responder, the CRL is down",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				sibling := ocspResponder(t, inter, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
				o.serve(func() []byte { return delegatedAnswer(t, leaf, inter, sibling, ocsp.Revoked) })
				c.down.Store(true)
			},
			status: "unavailable", check: "The certificate authority's answer couldn't be verified", unanswered: true, crlAsked: true,
		},
		{
			name: "OCSP signed by another CA",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				other := testCAUnder(t, "Test Intermediate", root)
				o.serve(func() []byte { return ocspAnswer(t, leaf, other, ocsp.Revoked) })
				c.down.Store(true)
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
		{
			name: "a stale OCSP answer is no answer",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.serve(func() []byte {
					der, err := ocsp.CreateResponse(inter.cert, inter.cert, ocsp.Response{
						Status: ocsp.Good, SerialNumber: leaf.SerialNumber,
						ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
					}, inter.key)
					if err != nil {
						t.Error(err)
					}
					return der
				})
				c.down.Store(true)
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
		{
			name: "a stale CRL is no answer",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
					Number: big.NewInt(1), ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
				}, inter.cert, inter.key)
				if err != nil {
					t.Fatal(err)
				}
				c.serve(func() []byte { return der })
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
		{
			name: "a stale OCSP answer still says revoked",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.serve(func() []byte {
					der, err := ocsp.CreateResponse(inter.cert, inter.cert, ocsp.Response{
						Status: ocsp.Revoked, SerialNumber: leaf.SerialNumber, RevokedAt: revokedAt, RevocationReason: ocsp.KeyCompromise,
						ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
					}, inter.key)
					if err != nil {
						t.Error(err)
					}
					return der
				})
			},
			status: "revoked", check: "OCSP checked online with the certificate authority", revoked: "2026-10-30T12:00:00Z",
		},
		{
			name: "a stale CRL that lists it still says revoked",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				c.serve(func() []byte {
					der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
						Number: big.NewInt(1), ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
						RevokedCertificateEntries: []x509.RevocationListEntry{{SerialNumber: leaf.SerialNumber, RevocationTime: revokedAt, ReasonCode: 1}},
					}, inter.cert, inter.key)
					if err != nil {
						t.Error(err)
					}
					return der
				})
			},
			status: "revoked", check: "CRL checked online with the certificate authority", revoked: "2026-10-30T12:00:00Z", crlAsked: true,
		},
		{
			name: "a hold in a stale CRL is no answer: it may have been lifted",
			setup: func(t *testing.T, leaf *x509.Certificate, o, c *switchable) {
				o.down.Store(true)
				c.serve(func() []byte {
					der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
						Number: big.NewInt(1), ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
						RevokedCertificateEntries: []x509.RevocationListEntry{{SerialNumber: leaf.SerialNumber, RevocationTime: revokedAt, ReasonCode: 6}},
					}, inter.cert, inter.key)
					if err != nil {
						t.Error(err)
					}
					return der
				})
			},
			status: "unavailable", check: "Couldn't reach the certificate authority's revocation service", unanswered: true, crlAsked: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trustRoot(t, root)
			ocspSrv, crlSrv := newSwitchable(t), newSwitchable(t)
			leaf, _ := newLeaf(t, inter, ocspSrv.URL, crlSrv.URL+"/inter.crl")
			tt.setup(t, leaf, ocspSrv, crlSrv)

			got, unanswered := checkRevocation(leaf, []*x509.Certificate{inter.cert})
			if got.Status != tt.status || got.Check != tt.check || got.RevokedAt != tt.revoked || unanswered != tt.unanswered {
				t.Errorf("checkRevocation = %+v, unanswered %v; want %q %q %q, unanswered %v", got, unanswered, tt.status, tt.check, tt.revoked, tt.unanswered)
			}
			if asked := crlSrv.hits.Load() > 0; asked != tt.crlAsked {
				t.Errorf("CRL asked: %v, want %v", asked, tt.crlAsked)
			}
		})
	}
}

func TestCheckRevocationAsksOnlyAboutATrustedChain(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	inter := testCAUnder(t, "Test Intermediate", root)
	srv := newSwitchable(t)
	leaf, _ := newLeaf(t, inter, srv.URL, srv.URL+"/inter.crl")

	// The root isn't trusted.
	trustRoot(t, testCAUnder(t, "Another Root", nil))
	if got, _ := checkRevocation(leaf, []*x509.Certificate{inter.cert}); got.Status != "not_checked" || got.Check != "Not checked: the issuer isn't trusted" {
		t.Errorf("untrusted root: %+v, want not checked", got)
	}
	// Trusted, but the backend doesn't hold the intermediate.
	trustRoot(t, root)
	if got, _ := checkRevocation(leaf, nil); got.Status != "not_checked" {
		t.Errorf("no intermediate: %+v, want not checked", got)
	}
	if srv.hits.Load() != 0 {
		t.Errorf("asked %d times about an untrusted chain", srv.hits.Load())
	}
}

func TestCheckRevocationAsksOnlyTheCertificatesOwnHosts(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	tracker := newSwitchable(t)
	// The intermediate names the tracker: only the certificate's own URLs count.
	interKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	inter := &testCA{newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(7), Subject: pkix.Name{CommonName: "Test Intermediate"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		OCSPServer: []string{tracker.URL}, CRLDistributionPoints: []string{tracker.URL + "/root.crl"},
	}, interKey, root), interKey}
	trustRoot(t, root)
	redirecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, tracker.URL+"/via-redirect", http.StatusTemporaryRedirect)
	}))
	defer redirecting.Close()
	leaf, _ := newLeaf(t, inter, redirecting.URL, redirecting.URL+"/inter.crl")

	got, unanswered := checkRevocation(leaf, []*x509.Certificate{inter.cert})
	if tracker.hits.Load() != 0 {
		t.Errorf("a host the certificate doesn't name was asked %d times", tracker.hits.Load())
	}
	if got.Status != "unavailable" || !unanswered {
		t.Errorf("checkRevocation = %+v, unanswered %v; want unavailable, unanswered", got, unanswered)
	}
}

// p12Store is a certificate folder holding a .p12 without a password with
// leaf, its key and the CA certificates.
func p12Store(t *testing.T, leaf *x509.Certificate, key any, cas []*x509.Certificate) string {
	t.Helper()
	data, err := goPkcs12.Passwordless.Encode(key, leaf, cas, "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "signer.p12"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestCheckCertificateRevocation(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	inter := testCAUnder(t, "Test Intermediate", root)
	trustRoot(t, root)
	ocspSrv := newSwitchable(t)
	leaf, key := newLeaf(t, inter, ocspSrv.URL, "")
	revokedAt := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	ocspSrv.serve(func() []byte {
		der, err := ocsp.CreateResponse(inter.cert, inter.cert, ocsp.Response{
			Status: ocsp.Revoked, SerialNumber: leaf.SerialNumber, ThisUpdate: time.Now().Add(-time.Minute), RevokedAt: revokedAt,
		}, inter.key)
		if err != nil {
			t.Error(err)
		}
		return der
	})

	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Get()
	// The intermediate comes only from the .p12.
	c.CertificateStores = []string{p12Store(t, leaf, key, []*x509.Certificate{inter.cert})}
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)
	if _, err := svc.ListCertificates(); err != nil {
		t.Fatal(err)
	}
	fp := certutil.GetFingerprint(leaf)

	check := func(what string) CertificateRevocation {
		t.Helper()
		got, err := svc.CheckCertificateRevocation(fp)
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		return got
	}
	if got := check("first"); got.Status != "revoked" || got.RevokedAt != "2026-10-30T12:00:00Z" {
		t.Errorf("first: %+v, want revoked on 30 Oct 2026", got)
	}
	check("again")
	if ocspSrv.hits.Load() != 1 {
		t.Errorf("asked %d times in a few minutes, want once", ocspSrv.hits.Load())
	}
	for k, e := range svc.certRevocations {
		e.at = e.at.Add(-6 * time.Minute)
		svc.certRevocations[k] = e
	}
	check("minutes later")
	if ocspSrv.hits.Load() != 2 {
		t.Errorf("asked %d times after the answer got old, want twice", ocspSrv.hits.Load())
	}

	// No answer: asked again the next time.
	ocspSrv.down.Store(true)
	svc.certRevocations = nil
	for range 2 {
		if got := check("down"); got.Status != "unavailable" {
			t.Errorf("down: %+v, want unavailable", got)
		}
	}
	if ocspSrv.hits.Load() != 4 {
		t.Errorf("asked %d times in all, want 4: an unanswered check isn't kept", ocspSrv.hits.Load())
	}

	c.CheckRevocationOnline = false
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	if got := check("setting off"); got.Status != "not_checked" || ocspSrv.hits.Load() != 4 {
		t.Errorf("setting off: %+v after %d requests; want not checked, nobody asked", got, ocspSrv.hits.Load())
	}

	c.CheckRevocationOnline = true
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	if got, err := svc.CheckCertificateRevocation("no such fingerprint"); err != nil || got.Status != "not_checked" {
		t.Errorf("an unknown fingerprint: %+v, %v; want not checked", got, err)
	}
}

// A certificate not in the last listing isn't looked for by listing again.
func TestCheckCertificateRevocationDoesNotListAgain(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	trustRoot(t, root)
	srv := newSwitchable(t)
	leaf, key := newLeaf(t, root, srv.URL, "")
	srv.serve(func() []byte { return ocspAnswer(t, leaf, root, ocsp.Good) })
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Get()
	c.CertificateStores = []string{p12Store(t, leaf, key, nil)}
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)
	got, err := svc.CheckCertificateRevocation(certutil.GetFingerprint(leaf))
	if err != nil || got.Status != "not_checked" || srv.hits.Load() != 0 {
		t.Errorf("CheckCertificateRevocation = %+v, %v after %d requests; want not checked, nobody asked", got, err, srv.hits.Load())
	}
	if svc.listed != nil {
		t.Error("the check listed the certificates")
	}
}

// Listing again would load PKCS#11 modules while a smart card may be signing.
func TestCheckCertificateRevocationUsesTheListedCertificates(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	trustRoot(t, root)
	srv := newSwitchable(t)
	leaf, key := newLeaf(t, root, srv.URL, "")
	srv.serve(func() []byte { return ocspAnswer(t, leaf, root, ocsp.Good) })
	cfg, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Get()
	c.CertificateStores = []string{p12Store(t, leaf, key, nil)}
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	svc := NewSignatureService(cfg)
	if _, err := svc.ListCertificates(); err != nil {
		t.Fatal(err)
	}
	// Found only if the check uses what was listed.
	c.CertificateStores = []string{t.TempDir()}
	if err := cfg.Update(c); err != nil {
		t.Fatal(err)
	}
	if got, err := svc.CheckCertificateRevocation(certutil.GetFingerprint(leaf)); err != nil || got.Status != "good" {
		t.Errorf("CheckCertificateRevocation = %+v, %v; want good", got, err)
	}
}

// An outdated CRL from the first distribution point doesn't hide a current
// one from the next.
func TestCheckRevocationPrefersACurrentCRL(t *testing.T) {
	root := testCAUnder(t, "Test Root", nil)
	inter := testCAUnder(t, "Test Intermediate", root)
	trustRoot(t, root)
	ocspSrv, oldSrv, newSrv := newSwitchable(t), newSwitchable(t), newSwitchable(t)
	ocspSrv.down.Store(true)
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leaf := newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, OCSPServer: []string{ocspSrv.URL},
		CRLDistributionPoints: []string{oldSrv.URL + "/old.crl", newSrv.URL + "/new.crl"},
	}, key, inter)
	old, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number: big.NewInt(1), ThisUpdate: time.Now().Add(-90 * 24 * time.Hour), NextUpdate: time.Now().Add(-60 * 24 * time.Hour),
	}, inter.cert, inter.key)
	if err != nil {
		t.Fatal(err)
	}
	oldSrv.serve(func() []byte { return old })
	revokedAt := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	current := emptyCRL(t, inter, x509.RevocationListEntry{SerialNumber: leaf.SerialNumber, RevocationTime: revokedAt})
	newSrv.serve(func() []byte { return current })

	got, unanswered := checkRevocation(leaf, []*x509.Certificate{inter.cert})
	if got.Status != "revoked" || got.RevokedAt != "2026-10-30T12:00:00Z" || unanswered || newSrv.hits.Load() != 1 {
		t.Errorf("checkRevocation = %+v, unanswered %v, second point asked %d times; want revoked on 30 Oct 2026, asked once", got, unanswered, newSrv.hits.Load())
	}
}
