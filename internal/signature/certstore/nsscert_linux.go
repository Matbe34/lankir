//go:build linux

package certstore

import (
	"crypto"
	"crypto/x509"
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/nss"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// NSSCertStore provides access to the NSS certificate database on Linux
type NSSCertStore struct {
	// NSS is initialized globally, no state needed
}

// NewNSSCertStore creates a new NSS certificate store wrapper
func NewNSSCertStore() (*NSSCertStore, error) {
	return &NSSCertStore{}, nil
}

// ListCertificates returns all certificates with private keys from the NSS database
func (n *NSSCertStore) ListCertificates() ([]types.Certificate, error) {
	nssCerts, err := nss.ListCertificates()
	if err != nil {
		return nil, fmt.Errorf("failed to list NSS certificates: %w", err)
	}

	var certs []types.Certificate
	for _, nc := range nssCerts {
		if !nc.HasPrivateKey {
			continue
		}

		cert := certutil.ConvertX509Certificate(nc.X509Cert, "NSS Database", nc.X509Cert.Subject.CommonName)
		cert.NSSNickname = nc.Nickname
		cert.RequiresPin = false
		cert.PinOptional = true

		certs = append(certs, cert)
	}

	return certs, nil
}

// GetSigner returns a crypto.Signer and the matching x509 certificate for the given fingerprint
func (n *NSSCertStore) GetSigner(fingerprint, pin string) (crypto.Signer, *x509.Certificate, error) {
	// Get all NSS certificates
	nssCerts, err := nss.ListCertificates()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list NSS certificates: %w", err)
	}

	// Find the certificate by fingerprint
	for _, nc := range nssCerts {
		if !nc.HasPrivateKey {
			continue
		}

		// Calculate fingerprint
		certFingerprint := certutil.GetFingerprint(nc.X509Cert)
		if certFingerprint == fingerprint {
			// Get NSS signer for this certificate
			nssSigner, err := nss.GetNSSSigner(nc.Nickname, pin)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to get NSS signer: %w", err)
			}
			return nssSigner, nc.X509Cert, nil
		}
	}

	return nil, nil, fmt.Errorf("certificate with fingerprint %s not found in NSS database", fingerprint)
}

// Close releases resources held by the NSS certificate store
func (n *NSSCertStore) Close() error {
	// NSS doesn't need explicit cleanup
	return nil
}
