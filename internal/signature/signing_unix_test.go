//go:build !windows

package signature

import (
	"crypto/x509"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestSignedFilePermissions(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	fp := onlyCert(t, s).Fingerprint
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)

	out, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID})
	if err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(out); fi.Mode().Perm() != 0o600 {
		t.Errorf("new file under umask 077: want 0600, got %v", fi.Mode().Perm())
	}

	existing := filepath.Join(t.TempDir(), "existing.pdf")
	if err := os.WriteFile(existing, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(existing, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignPDF(SignRequest{PDFPath: plainTestPDF(t), OutputPath: existing, CertFingerprint: fp, PIN: "secret", ProfileID: invisibleID}); err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(existing); fi.Mode().Perm() != 0o640 {
		t.Errorf("replaced file: want its mode 0640 kept, got %v", fi.Mode().Perm())
	}
}

func TestDefaultOutputSkipsDanglingSymlink(t *testing.T) {
	store := t.TempDir()
	writeTestP12(t, store, "me.p12", "secret", x509.KeyUsageDigitalSignature)
	s := newStoreService(t, store)
	in := plainTestPDF(t)
	link := strings.TrimSuffix(in, ".pdf") + "_signed.pdf"
	target := filepath.Join(t.TempDir(), "elsewhere.pdf")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	out, err := s.SignPDF(SignRequest{PDFPath: in, CertFingerprint: onlyCert(t, s).Fingerprint, PIN: "secret", ProfileID: invisibleID})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(out, "_signed_2.pdf") {
		t.Errorf("want the next free name past the symlink, got %s", out)
	}
	if _, err := os.Lstat(target); err == nil {
		t.Error("signing wrote through a dangling symlink")
	}
}
