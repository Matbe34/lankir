//go:build cgo

package pdf

import (
	"os"
	"testing"
)

// TestSuppressRestoreStderrRoundTrip ensures that after Suppress + Restore,
// stderr fd 2 points back at the original target. Compares device+inode
// snapshots via os.SameFile, which catches the case where suppress redirects
// fd 2 to /dev/null and restore is a no-op.
func TestSuppressRestoreStderrRoundTrip(t *testing.T) {
	before, err := os.Stderr.Stat()
	if err != nil {
		t.Skipf("cannot stat stderr: %v", err)
	}

	SuppressMuPDFWarnings()
	RestoreMuPDFWarnings()

	after, err := os.Stderr.Stat()
	if err != nil {
		t.Fatalf("stderr unusable after restore: %v", err)
	}
	if !os.SameFile(before, after) {
		t.Fatalf("stderr fd not restored: before=%v after=%v", before.Name(), after.Name())
	}
}
