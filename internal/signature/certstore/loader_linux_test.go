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

	if _, err := store.ListCertificates(); err != nil {
		t.Fatalf("ListCertificates: %v", err)
	}
}
