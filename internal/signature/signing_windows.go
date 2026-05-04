//go:build windows

package signature

import (
	"crypto"
	"crypto/x509"
	"fmt"
	"io"

	"github.com/Matbe34/lankir/internal/signature/certstore"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// signWithNSS is a stub on Windows (NSS is Linux-only).
func (s *SignatureService) signWithNSS(_ string, _ *types.Certificate, _ string, _ *SignatureProfile) (string, error) {
	return "", fmt.Errorf("NSS certificate signing is only supported on Linux")
}

// signWithPlatformStore signs using the Windows Certificate Store via the
// abstracted certstore package.
func (s *SignatureService) signWithPlatformStore(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	outputPath := generateSignedPDFPath(pdfPath)

	store, err := certstore.OpenPlatformStore()
	if err != nil {
		return "", fmt.Errorf("open Windows certificate store: %w", err)
	}
	defer store.Close()

	signer, x509Cert, err := store.GetSigner(cert.Fingerprint, password)
	if err != nil {
		return "", fmt.Errorf("get signer: %w", err)
	}

	wrapped := &windowsCertStoreSigner{signer: signer, cert: x509Cert}
	if err := s.signPDFWithSigner(pdfPath, outputPath, wrapped, cert, profile); err != nil {
		return "", fmt.Errorf("sign PDF: %w", err)
	}
	return outputPath, nil
}

// windowsCertStoreSigner adapts a crypto.Signer + *x509.Certificate pair to
// the CertificateSigner interface (Public/Sign/Certificate).
type windowsCertStoreSigner struct {
	signer crypto.Signer
	cert   *x509.Certificate
}

func (w *windowsCertStoreSigner) Public() crypto.PublicKey { return w.signer.Public() }
func (w *windowsCertStoreSigner) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	return w.signer.Sign(rand, digest, opts)
}
func (w *windowsCertStoreSigner) Certificate() *x509.Certificate { return w.cert }
