package signature

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/timestamp"
	"github.com/google/uuid"
	gopkcs12 "software.sslmate.com/src/go-pkcs12"
)

// writeTestP12 writes a password-protected PKCS#12 holding a fresh key and a
// self-signed certificate with the given key usage.
func writeTestP12(t *testing.T, dir, name, password string, usage x509.KeyUsage) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "P12 Signer"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     usage,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	data, err := gopkcs12.Modern.Encode(key, cert, nil, password)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// newStoreService returns a service whose only certificate source is storeDir.
func newStoreService(t *testing.T, storeDir string) *SignatureService {
	t.Helper()
	cfgService, err := config.NewServiceWithDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cfg := cfgService.Get()
	cfg.CertificateStores = []string{storeDir}
	cfg.TokenLibraries = []string{filepath.Join(t.TempDir(), "none.so")}
	if err := cfgService.Update(cfg); err != nil {
		t.Fatal(err)
	}
	return NewSignatureService(cfgService)
}

// onlyCert returns the single certificate the service lists.
func onlyCert(t *testing.T, s *SignatureService) types.Certificate {
	t.Helper()
	certs, err := s.ListCertificates()
	if err != nil {
		t.Fatal(err)
	}
	if len(certs) != 1 {
		t.Fatalf("want 1 certificate, got %d: %+v", len(certs), certs)
	}
	return certs[0]
}

var invisibleID = DefaultInvisibleProfile().ID.String()

func TestSignWithPasswordProtectedP12(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)

	cert := onlyCert(t, s)
	if !cert.RequiresPin || !cert.CanSign || cert.Fingerprint == "" {
		t.Fatalf("locked p12 must be listed as signing-capable and needing a password: %+v", cert)
	}

	pdfPath := plainTestPDF(t)
	req := SignRequest{PDFPath: pdfPath, CertFingerprint: cert.Fingerprint, PIN: "wrong", ProfileID: invisibleID}
	if _, err := s.SignPDF(req); !errors.Is(err, types.ErrIncorrectPIN) {
		t.Fatalf("wrong password: want ErrIncorrectPIN, got %v", err)
	}

	req.PIN = "secret"
	out, err := s.SignPDF(req)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if want := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"; out != want {
		t.Fatalf("output: want %s, got %s", want, out)
	}
	sigs, err := s.VerifySignatures(out)
	if err != nil || len(sigs) != 1 || !sigs[0].IsValid {
		t.Fatalf("verify: %v %+v", err, sigs)
	}
	if sigs[0].SignerName != "P12 Signer" {
		t.Errorf("signer name: want the unlocked certificate's CN, got %q", sigs[0].SignerName)
	}

	second, err := s.SignPDF(req)
	if err != nil {
		t.Fatalf("second sign: %v", err)
	}
	if second == out || !strings.HasSuffix(second, "_signed_2.pdf") {
		t.Fatalf("second output must not overwrite the first, got %s", second)
	}
}

func TestSignWithLockedP12LackingSigningKeyUsage(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "enc.p12", "secret", x509.KeyUsageKeyEncipherment)
	s := newStoreService(t, store)

	_, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID})
	if err == nil || !strings.Contains(err.Error(), "cannot be used for signing") {
		t.Fatalf("want a key usage error, got %v", err)
	}
}

func TestSignToChosenOutput(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint
	pdfPath := plainTestPDF(t)

	if _, err := s.SignPDF(SignRequest{PDFPath: pdfPath, OutputPath: pdfPath, CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID}); err == nil {
		t.Fatal("signing onto the input file must be refused")
	}

	existing := filepath.Join(t.TempDir(), "copy.pdf")
	if err := os.WriteFile(existing, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := s.SignPDF(SignRequest{PDFPath: pdfPath, OutputPath: existing, CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID})
	if err != nil || out != existing {
		t.Fatalf("sign to chosen path: %q %v", out, err)
	}
	if sigs, err := s.VerifySignatures(out); err != nil || len(sigs) != 1 {
		t.Fatalf("verify chosen output: %v %+v", err, sigs)
	}

	// A failed signing must leave a file the user chose to replace untouched.
	if err := os.WriteFile(existing, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignPDF(SignRequest{PDFPath: pdfPath, OutputPath: existing, CertFingerprint: fp, PIN: "bad", ProfileID: invisibleID}); err == nil {
		t.Fatal("want wrong-password error")
	}
	if data, _ := os.ReadFile(existing); string(data) != "keep me" {
		t.Fatalf("failed signing clobbered the target: %q", data)
	}
}

func TestSignSendsTimestampRequestToTSA(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)

	var contentType string
	tsa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		http.Error(w, "no", http.StatusServiceUnavailable)
	}))
	defer tsa.Close()

	pdfPath := plainTestPDF(t)
	_, err := s.SignPDF(SignRequest{PDFPath: pdfPath, CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID, TSAURL: tsa.URL})
	if contentType != "application/timestamp-query" {
		t.Fatalf("TSA got no timestamp query (content type %q); sign error: %v", contentType, err)
	}
	if err == nil {
		t.Fatal("a failing TSA must fail the signing")
	}
	if _, statErr := os.Stat(strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"); statErr == nil {
		t.Fatal("failed signing left an output file")
	}
}

func resetLocationCache() {
	locationCacheMutex.Lock()
	defer locationCacheMutex.Unlock()
	locationCache, locationCacheTime = "", time.Time{}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSigningLocation(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint

	profile := DefaultVisibleProfile()
	profile.ID = uuid.New()
	profile.Name = "With location"
	profile.Location = "Barcelona"
	profile.Appearance.ShowLocation = true
	if err := s.SaveSignatureProfile(profile); err != nil {
		t.Fatal(err)
	}

	calls := 0
	saved := locationClient
	t.Cleanup(func() { locationClient = saved; resetLocationCache() })
	locationClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"city":"Girona","country":"ES"}`))}, nil
	})}
	resetLocationCache()

	sign := func() string {
		t.Helper()
		out, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: fp, PIN: "secret", ProfileID: profile.ID.String()})
		if err != nil {
			t.Fatal(err)
		}
		sigs, err := s.VerifySignatures(out)
		if err != nil || len(sigs) != 1 {
			t.Fatalf("verify: %v %+v", err, sigs)
		}
		return sigs[0].Location
	}

	if loc := sign(); loc != "Barcelona" || calls != 0 {
		t.Fatalf("lookup off: want the profile's location and no network call, got %q after %d calls", loc, calls)
	}

	cfg := s.configService.Get()
	cfg.SignatureLocationLookup = true
	if err := s.configService.Update(cfg); err != nil {
		t.Fatal(err)
	}
	if loc := sign(); loc != "Girona, ES" || calls != 1 {
		t.Fatalf("lookup on: want the looked-up location, got %q after %d calls", loc, calls)
	}
}

func TestCertifySignedFieldWithoutSigFlags(t *testing.T) {
	// A signed /Sig field with no /SigFlags: verification may find nothing,
	// but pdfsign still refuses a certification signature.
	p := writeTestPDF(t, []string{
		"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>",
		"<< /FT /Sig /T (Sig1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>",
		"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0 0 0] /Contents <00> >>",
	})
	out := filepath.Join(t.TempDir(), "out.pdf")
	s := NewSignatureService(nil)
	if err := s.signPDFWithSigner(p, out, newTestSigner(t), &types.Certificate{Name: "Test Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatalf("sign: %v", err)
	}
}

// writeChainP12 writes a PKCS#12 holding a leaf key and certificate issued by
// a fresh CA, with the CA certificate in the bag, and returns the CA.
func writeChainP12(t *testing.T, dir, name, password string) *x509.Certificate {
	t.Helper()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	caTpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign,
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, caKey.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "Leaf Signer"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ca, key.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	data, err := gopkcs12.Modern.Encode(key, leaf, []*x509.Certificate{ca}, password)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return ca
}

// signatureContents returns the decoded /Contents (the CMS) of every signature in the PDF.
func signatureContents(t *testing.T, pdfPath string) [][]byte {
	t.Helper()
	data, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatal(err)
	}
	var out [][]byte
	for _, m := range regexp.MustCompile(`/Contents\s*<([0-9a-fA-F]+)>`).FindAllSubmatch(data, -1) {
		der, err := hex.DecodeString(string(m[1]))
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, der)
	}
	return out
}

func TestSignedOutputIsPAdESAndCertifiesFirstSignature(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	out, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte("/SubFilter /ETSI.CAdES.detached")) {
		t.Error("signature is not /ETSI.CAdES.detached")
	}
	if !regexp.MustCompile(`/Perms\s*<<\s*/DocMDP`).Match(data) {
		t.Error("first invisible signature must certify: catalog has no /Perms /DocMDP")
	}
	if !regexp.MustCompile(`/TransformMethod /DocMDP\s*/TransformParams\s*<<[^>]*/P 2\b`).Match(data) {
		t.Error("certification must allow form filling and signing (/P 2)")
	}
	if sigs, err := s.VerifySignatures(out); err != nil || len(sigs) != 1 || !sigs[0].IsValid {
		t.Fatalf("verify: %v %+v", err, sigs)
	}
}

func TestSignEmbedsCAChain(t *testing.T) {
	store := t.TempDir()
	ca := writeChainP12(t, store, "leaf.p12", "secret")
	s := newStoreService(t, store)
	out, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID})
	if err != nil {
		t.Fatal(err)
	}
	cms := signatureContents(t, out)
	if len(cms) != 1 || !bytes.Contains(cms[0], ca.Raw) {
		t.Fatal("the signature does not carry the CA certificate")
	}
}

func TestDefaultOutputNamesFromConcurrentSigning(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint
	in := plainTestPDF(t)

	const n = 4
	var wg sync.WaitGroup
	outs, errs := make([]string, n), make([]error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outs[i], errs[i] = s.SignPDF(SignRequest{PDFPath: in, CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID})
		}()
	}
	wg.Wait()
	seen := map[string]bool{}
	for i := range n {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if seen[outs[i]] {
			t.Fatalf("two signings wrote %s", outs[i])
		}
		seen[outs[i]] = true
		if sigs, err := s.VerifySignatures(outs[i]); err != nil || len(sigs) != 1 {
			t.Fatalf("verify %s: %v %+v", outs[i], err, sigs)
		}
	}
}

func TestDefaultOutputWithTooLongName(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint
	in := filepath.Join(t.TempDir(), strings.Repeat("a", 246)+".pdf")
	data, err := os.ReadFile(plainTestPDF(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(in, data, 0o644); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := s.SignPDF(SignRequest{PDFPath: in, CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID})
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("want an error for a signed-copy name longer than the file system allows")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("SignPDF did not return")
	}
}

func TestJunkP12IsNotListed(t *testing.T) {
	store := t.TempDir()
	if err := os.WriteFile(filepath.Join(store, "junk.p12"), []byte("not a pkcs12 file"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	if c := onlyCert(t, s); !strings.HasSuffix(c.FilePath, "me.p12") {
		t.Fatalf("listed %s instead of me.p12", c.FilePath)
	}
}

func TestSignWithCertificateWithoutKeyUsage(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "any.p12", "secret", 0)
	s := newStoreService(t, store)
	if _, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID}); err != nil {
		t.Fatalf("a certificate without a key usage extension is unrestricted: %v", err)
	}
}

func TestExpiredCertificateRefusedBeforeUnlocking(t *testing.T) {
	store := t.TempDir()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "Expired"},
		NotBefore:    time.Now().Add(-48 * time.Hour),
		NotAfter:     time.Now().Add(-24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	// An empty password lists the real certificate, so its validity is known up front.
	data, err := gopkcs12.Modern.Encode(key, cert, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store, "old.p12"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	s := newStoreService(t, store)
	_, err = s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "wrong", ProfileID: invisibleID})
	if err == nil || errors.Is(err, types.ErrIncorrectPIN) || !strings.Contains(err.Error(), "not valid") {
		t.Fatalf("want a validity error without trying the PIN, got %v", err)
	}
}

func TestCheckUnlockedCertificate(t *testing.T) {
	a, b := newTestSigner(t), newTestSigner(t)
	selected := certutil.ConvertX509Certificate(a.cert, "pkcs11", "")
	if err := checkUnlockedCertificate(&selected, b.cert); err == nil {
		t.Error("a token key whose certificate differs from the selected one must be refused")
	}
	if err := checkUnlockedCertificate(&selected, a.cert); err != nil {
		t.Errorf("matching certificate refused: %v", err)
	}
	locked := types.Certificate{Fingerprint: "file:/x/me.p12", Source: "User File"}
	if err := checkUnlockedCertificate(&locked, b.cert); err != nil {
		t.Errorf("a locked file has no fingerprint to compare: %v", err)
	}
}

func TestValidatePositionAllowsNegativeOrigins(t *testing.T) {
	if err := validatePosition(&SignaturePosition{Page: 1, X: -50, Y: -20, Width: 100, Height: 40}); err != nil {
		t.Errorf("page boxes can start below 0: %v", err)
	}
	for _, p := range []SignaturePosition{{X: -20000, Y: 0}, {X: 0, Y: 20000}} {
		if err := validatePosition(&p); err == nil {
			t.Errorf("want an error for %+v", p)
		}
	}
}

func TestSignRecordsLastUsed(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint
	if _, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID}); err != nil {
		t.Fatal(err)
	}
	if c := s.configService.Get(); c.LastCertificateFingerprint != fp || c.LastSignatureProfileID != invisibleID {
		t.Fatalf("last used not recorded: %q %q", c.LastCertificateFingerprint, c.LastSignatureProfileID)
	}
}

func TestSignWithTimestamp(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)

	tsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tsaTpl := &x509.Certificate{
		SerialNumber: big.NewInt(7),
		Subject:      pkix.Name{CommonName: "Test TSA"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageTimeStamping},
	}
	tsaDER, err := x509.CreateCertificate(rand.Reader, tsaTpl, tsaTpl, tsaKey.Public(), tsaKey)
	if err != nil {
		t.Fatal(err)
	}
	tsaCert, _ := x509.ParseCertificate(tsaDER)
	tsa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		req, err := timestamp.ParseRequest(body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ts := timestamp.Timestamp{
			HashAlgorithm:     req.HashAlgorithm,
			HashedMessage:     req.HashedMessage,
			Time:              time.Now(),
			Nonce:             req.Nonce,
			Policy:            asn1.ObjectIdentifier{1, 2, 3, 4, 1},
			AddTSACertificate: true,
		}
		resp, err := ts.CreateResponseWithOpts(tsaCert, tsaKey, crypto.SHA256)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/timestamp-reply")
		_, _ = w.Write(resp)
	}))
	defer tsa.Close()

	out, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID, TSAURL: tsa.URL})
	if err != nil {
		t.Fatal(err)
	}
	sigs, err := s.VerifySignatures(out)
	if err != nil || len(sigs) != 1 || !sigs[0].IsValid {
		t.Fatalf("verify: %v %+v", err, sigs)
	}
	if !strings.Contains(sigs[0].ValidationMessage, "with valid") || !strings.Contains(sigs[0].ValidationMessage, "timestamp") {
		t.Fatalf("no valid timestamp reported: %q", sigs[0].ValidationMessage)
	}
}

// The default output name is claimed only once the signed bytes exist, so a crash or
// panic mid-signing can't leave an empty <name>_signed.pdf behind.
func TestDefaultOutputNotClaimedWhileSigning(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)

	pdfPath := plainTestPDF(t)
	claimed := false
	tsa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := os.Lstat(strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf")
		claimed = err == nil
		http.Error(w, "no", http.StatusServiceUnavailable)
	}))
	defer tsa.Close()

	_, _ = s.SignPDF(SignRequest{PDFPath: pdfPath, CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID, TSAURL: tsa.URL})
	if claimed {
		t.Fatal("output name was claimed before signing finished")
	}
	entries, _ := os.ReadDir(filepath.Dir(pdfPath))
	for _, e := range entries {
		if e.Name() != filepath.Base(pdfPath) {
			t.Errorf("failed signing left %s behind", e.Name())
		}
	}
}
