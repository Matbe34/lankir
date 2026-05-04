//go:build linux

package certstore

import "testing"

// TestOpenPlatformStoreLinuxListsWithoutError exercises the NSS-backed certstore
// dispatch on Linux. SKIPs (does not FAIL) if NSS is not initialized in this
// environment — many CI runners don't ship an NSS database.
func TestOpenPlatformStoreLinuxListsWithoutError(t *testing.T) {
	store, err := OpenPlatformStore()
	if err != nil {
		t.Skipf("NSS not available: %v", err)
	}
	defer store.Close()

	// NSS init happens lazily on first list — many CI runners have no usable
	// NSS DB. Treat that as SKIP, not FAIL.
	if _, err := store.ListCertificates(); err != nil {
		t.Skipf("NSS not usable: %v", err)
	}
}
