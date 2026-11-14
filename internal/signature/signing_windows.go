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

// openNSSSigner is a stub on Windows (NSS is Linux-only).
func openNSSSigner(_ *types.Certificate, _ string) (CertificateSigner, func(), error) {
	return nil, nil, fmt.Errorf("NSS certificate signing is only supported on Linux")
}

// openPlatformSigner unlocks a key in the Windows Certificate Store via the
// abstracted certstore package.
func openPlatformSigner(cert *types.Certificate, password string) (CertificateSigner, func(), error) {
	store, err := certstore.OpenPlatformStore()
	if err != nil {
		return nil, nil, fmt.Errorf("open Windows certificate store: %w", err)
	}

	signer, x509Cert, err := store.GetSigner(cert.Fingerprint, password)
	if err != nil {
		store.Close()
		return nil, nil, fmt.Errorf("get signer: %w", err)
	}
	return &windowsCertStoreSigner{signer: signer, cert: x509Cert}, func() { store.Close() }, nil
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
