//go:build windows

package certstore

// openPlatformStoreImpl opens the Windows Certificate Store
func openPlatformStoreImpl() (CertificateStore, error) {
	return NewWindowsCertStore()
}
