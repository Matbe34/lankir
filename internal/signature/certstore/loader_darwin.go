//go:build darwin

package certstore

import "fmt"

// openPlatformStoreImpl is a stub for macOS Keychain support (future implementation)
func openPlatformStoreImpl() (CertificateStore, error) {
	// TODO: Implement macOS Keychain support
	return nil, fmt.Errorf("macOS certificate store not yet implemented")
}
