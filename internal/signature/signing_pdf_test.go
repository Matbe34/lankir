package signature

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
)

type testSigner struct {
	key  *rsa.PrivateKey
	cert *x509.Certificate
}

func (s testSigner) Public() crypto.PublicKey { return s.key.Public() }
func (s testSigner) Sign(r io.Reader, d []byte, o crypto.SignerOpts) ([]byte, error) {
	return s.key.Sign(r, d, o)
}
func (s testSigner) Certificate() *x509.Certificate { return s.cert }

func newTestSigner(t *testing.T) testSigner {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "Test Signer"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return testSigner{key, cert}
}

// writeTestPDF writes a minimal one-page PDF built from the given objects
// (object 1 must be the catalog).
func writeTestPDF(t *testing.T, objs []string) string {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	offsets := make([]int, 0, len(objs))
	for i, o := range objs {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	p := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(p, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func plainTestPDF(t *testing.T) string {
	return writeTestPDF(t, []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
	})
}

func TestSignAlreadySignedPDF(t *testing.T) {
	s := NewSignatureService(nil)
	signer := newTestSigner(t)
	cert := &types.Certificate{Name: "Test Signer"}
	dir := t.TempDir()

	first := filepath.Join(dir, "first.pdf")
	if err := s.signPDFWithSigner(plainTestPDF(t), first, signer, cert, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatalf("first invisible signature: %v", err)
	}

	for name, profile := range map[string]*SignatureProfile{
		"invisible": DefaultInvisibleProfile(),
		"visible":   DefaultVisibleProfile(),
	} {
		t.Run(name, func(t *testing.T) {
			out := filepath.Join(dir, name+".pdf")
			if err := s.signPDFWithSigner(first, out, signer, cert, profile, "", ""); err != nil {
				t.Fatalf("second signature: %v", err)
			}
			sigs, err := s.VerifySignatures(out)
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if len(sigs) != 2 {
				t.Fatalf("want 2 signatures, got %d", len(sigs))
			}
			for i, sig := range sigs {
				if !sig.IsValid {
					t.Errorf("signature %d invalid: %s", i, sig.ValidationMessage)
				}
			}
		})
	}
}

func TestVerifyUnsignedSignatureField(t *testing.T) {
	p := writeTestPDF(t, []string{
		"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 1 >> >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>",
		"<< /FT /Sig /T (Sig1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>",
	})
	sigs, err := NewSignatureService(nil).VerifySignatures(p)
	if err != nil {
		t.Fatalf("unsigned signature field must not be an error: %v", err)
	}
	if len(sigs) != 0 {
		t.Fatalf("want 0 signatures, got %d", len(sigs))
	}
}

func TestCertifyWithUnreadablePerms(t *testing.T) {
	// pdfsign refuses certification here with "cannot add a CertificationSignature: ...".
	p := writeTestPDF(t, []string{
		"<< /Type /Catalog /Pages 2 0 R /Perms [] >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
	})
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := NewSignatureService(nil).signPDFWithSigner(p, out, newTestSigner(t), &types.Certificate{Name: "Test Signer"}, DefaultInvisibleProfile(), "", ""); err != nil {
		t.Fatalf("want an approval signature when certification is refused: %v", err)
	}
}

func TestValidatePositionRejectsNonFinite(t *testing.T) {
	for _, p := range []SignaturePosition{
		{Page: 1, X: math.NaN(), Y: 10, Width: 100, Height: 50},
		{Page: 1, X: 10, Y: math.Inf(1), Width: 100, Height: 50},
		{Page: 1, X: 10, Y: 10, Width: math.NaN(), Height: 50},
		{Page: 1, X: 10, Y: 10, Width: 100, Height: math.NaN()},
	} {
		if err := validatePosition(&p); err == nil {
			t.Errorf("%+v accepted", p)
		}
	}
}
