package certstore

import "fmt"

// OpenPlatformStore opens the platform-specific certificate store
// - Linux: NSS certificate database
// - Windows: Windows Certificate Store
// - macOS: Keychain (future)
func OpenPlatformStore() (CertificateStore, error) {
	store, err := openPlatformStoreImpl()
	if err != nil {
		return nil, fmt.Errorf("failed to open platform certificate store: %w", err)
	}
	return store, nil
}
