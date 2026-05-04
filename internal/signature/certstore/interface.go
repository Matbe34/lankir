package certstore

import (
	"crypto"
	"crypto/x509"

	"github.com/Matbe34/lankir/internal/signature/types"
)

// CertificateStore abstracts platform-specific certificate stores
// (NSS on Linux, Windows Certificate Store on Windows, Keychain on macOS)
type CertificateStore interface {
	// ListCertificates returns all certificates with private keys
	ListCertificates() ([]types.Certificate, error)

	// GetSigner returns the crypto.Signer AND the matching x509 certificate.
	// pin is used for hardware tokens / PKCS#11 PINs; ignored for OS stores
	// that prompt the user (Windows CryptoAPI).
	GetSigner(fingerprint, pin string) (crypto.Signer, *x509.Certificate, error)

	// Close releases resources held by the certificate store
	Close() error
}
