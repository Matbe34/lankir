//go:build darwin

package signature

import (
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/types"
)

// signWithNSS is a stub on macOS (NSS is Linux-only)
func (s *SignatureService) signWithNSS(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	return "", fmt.Errorf("NSS certificate signing is only supported on Linux")
}

// signWithPlatformStore is a stub on macOS (Keychain not yet implemented)
func (s *SignatureService) signWithPlatformStore(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	return "", fmt.Errorf("macOS Keychain certificate signing not yet implemented")
}
