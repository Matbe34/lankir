//go:build windows

package signature

import (
	"log/slog"

	"github.com/Matbe34/lankir/internal/signature/certstore"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// loadPlatformCertificates loads certificates from platform-specific certificate stores
// On Windows, this loads from Windows Certificate Store
func loadPlatformCertificates() ([]types.Certificate, error) {
	return LoadWindowsCertificates()
}

// LoadWindowsCertificates retrieves certificates with private keys from the Windows Certificate Store
func LoadWindowsCertificates() ([]types.Certificate, error) {
	store, err := certstore.OpenPlatformStore()
	if err != nil {
		slog.Warn("failed to open Windows certificate store", "error", err)
		return nil, err
	}
	defer store.Close()

	certs, err := store.ListCertificates()
	if err != nil {
		return nil, err
	}

	return certs, nil
}
