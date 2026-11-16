//go:build !windows

package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestWorkingCopies_OnlyTheUserCanRead(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 2)
	if _, err := s.RotatePages(doc.ID, []int{1}, 90); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op")); err != nil {
		t.Fatal(err)
	}
	// The host and process id let a later start tell whether the session ended.
	if name := filepath.Base(s.workDir); !strings.HasPrefix(name, fmt.Sprintf("session-%s-%d-", sessionHost(), os.Getpid())) {
		t.Errorf("session dir %s doesn't name the host and process", name)
	}
	// A digest keeps "lab-01" and "lab_01" apart, never holds a "-", and
	// stays short for macOS host names of up to 255 bytes.
	for _, host := range []string{"lab-01", "lab_01", strings.Repeat("h", 255)} {
		if tag := hostTag(host); len(tag) != 16 || strings.Contains(tag, "-") {
			t.Errorf("hostTag(%.20q) = %q, want 16 characters without a -", host, tag)
		}
	}
	if hostTag("lab-01") == hostTag("lab_01") {
		t.Error(`"lab-01" and "lab_01" share a host part`)
	}
	if host, _ := os.Hostname(); sessionHost() != hostTag(host) {
		t.Errorf("host part %q, want hostTag(%q)", sessionHost(), host)
	}
	if info, err := os.Stat(s.workDir); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("session dir: %v, %v; want 0700", info.Mode().Perm(), err)
	}
	for _, name := range workFiles(t, s) {
		if info, err := os.Stat(filepath.Join(s.workDir, name)); err != nil || info.Mode().Perm() != 0o600 {
			t.Errorf("%s: %v, %v; want 0600", name, info.Mode().Perm(), err)
		}
	}
}

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
