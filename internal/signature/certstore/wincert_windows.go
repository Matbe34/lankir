//go:build windows

package certstore

import (
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/github/smimesign/certstore"
)

// WindowsCertStore provides access to the Windows Certificate Store
type WindowsCertStore struct {
	store certstore.Store
}

// NewWindowsCertStore opens the Windows Certificate Store
func NewWindowsCertStore() (*WindowsCertStore, error) {
	// Open Windows "MY" store (Personal Certificates)
	store, err := certstore.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open Windows certificate store: %w", err)
	}

	return &WindowsCertStore{store: store}, nil
}

// ListCertificates returns all certificates with private keys from the Windows Certificate Store
func (w *WindowsCertStore) ListCertificates() ([]types.Certificate, error) {
	idents, err := w.store.Identities()
	if err != nil {
		return nil, fmt.Errorf("failed to list identities: %w", err)
	}
	defer func() {
		for _, id := range idents {
			id.Close()
		}
	}()

	var certs []types.Certificate
	for _, identity := range idents {
		// Get X.509 certificate
		x509Cert, err := identity.Certificate()
		if err != nil {
			continue
		}

		// Convert to our certificate type
		cert := certutil.ConvertX509Certificate(x509Cert, "Windows Certificate Store", x509Cert.Subject.CommonName)
		cert.RequiresPin = false
		cert.PinOptional = false

		certs = append(certs, cert)
	}

	return certs, nil
}

// GetSigner returns a crypto.Signer and the matching x509 certificate for the given fingerprint
func (w *WindowsCertStore) GetSigner(fingerprint, pin string) (crypto.Signer, *x509.Certificate, error) {
	idents, err := w.store.Identities()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list identities: %w", err)
	}
	defer func() {
		for _, id := range idents {
			id.Close()
		}
	}()

	for _, identity := range idents {
		cert, err := identity.Certificate()
		if err != nil {
			continue
		}

		// Compare fingerprints (SHA-256)
		certFingerprint := getFingerprint(cert.Raw)
		if certFingerprint == fingerprint {
			// Return the signer from identity along with the matching certificate
			signer, err := identity.Signer()
			if err != nil {
				return nil, nil, fmt.Errorf("failed to get signer: %w", err)
			}
			return signer, cert, nil
		}
	}

	return nil, nil, fmt.Errorf("certificate with fingerprint %s not found in Windows Certificate Store", fingerprint)
}

// Close releases resources held by the Windows Certificate Store
func (w *WindowsCertStore) Close() error {
	w.store.Close()
	return nil
}

// getFingerprint calculates SHA-256 fingerprint of certificate
func getFingerprint(certDER []byte) string {
	hash := sha256.Sum256(certDER)
	return hex.EncodeToString(hash[:])
}
