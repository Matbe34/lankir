//go:build !windows

package pdf

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestSavePDFAs_NewFileFollowsTheUmask(t *testing.T) {
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-A"), 0o600)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	newPath := filepath.Join(dir, "new.pdf")
	s.chooseSaveAsPath(doc.ID, newPath)
	if _, err := s.SavePDFAs(doc.ID, newPath, []byte("%PDF-x")); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(newPath); info.Mode().Perm() != 0o600 {
		t.Errorf("new file mode = %v, want 0600 (0666 &^ umask 077)", info.Mode().Perm())
	}
}
