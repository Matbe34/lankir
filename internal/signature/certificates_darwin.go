//go:build darwin

package signature

import (
	"log/slog"

	"github.com/Matbe34/lankir/internal/signature/types"
)

// loadPlatformCertificates loads certificates from platform-specific certificate stores
// On macOS, this would load from Keychain (not yet implemented)
func loadPlatformCertificates() ([]types.Certificate, error) {
	slog.Debug("macOS Keychain certificate support not yet implemented")
	return []types.Certificate{}, nil
}
