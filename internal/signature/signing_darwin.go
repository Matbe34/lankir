//go:build darwin

package signature

import (
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/types"
)

// openNSSSigner is a stub on macOS (NSS is Linux-only)
func openNSSSigner(_ *types.Certificate, _ string) (CertificateSigner, func(), error) {
	return nil, nil, fmt.Errorf("NSS certificate signing is only supported on Linux")
}

// openPlatformSigner is a stub on macOS (Keychain not yet implemented)
func openPlatformSigner(_ *types.Certificate, _ string) (CertificateSigner, func(), error) {
	return nil, nil, fmt.Errorf("macOS Keychain certificate signing not yet implemented")
}
