//go:build linux

package certstore

// openPlatformStoreImpl opens the NSS certificate database on Linux
func openPlatformStoreImpl() (CertificateStore, error) {
	return NewNSSCertStore()
}
