//go:build !windows

package pdfops

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// A new output (e.g. a decrypted copy) must follow the umask, not be world-readable.
func TestNewOutputFollowsUmask(t *testing.T) {
	in := fixture(t, 3)
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)

	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := DeletePages(in, out, []int{2}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(out)
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode %o, want 600", got)
	}
}

func TestReplacedOutputKeepsMode(t *testing.T) {
	in := fixture(t, 3)
	if err := os.Chmod(in, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := DeletePages(in, in, []int{2}); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(in)
	if got := fi.Mode().Perm(); got != 0o640 {
		t.Fatalf("mode %o, want 640", got)
	}
}
