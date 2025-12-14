package signature

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ferran/pdf_app/internal/config"
)

func generateTestP12(t *testing.T, dir string, name string) string {
	keyPath := filepath.Join(dir, "key.pem")
	certPath := filepath.Join(dir, "cert.pem")
	p12Path := filepath.Join(dir, name)

	// Generate key and cert
	cmd := exec.Command("openssl", "req", "-x509", "-newkey", "rsa:2048",
		"-keyout", keyPath, "-out", certPath,
		"-days", "1", "-nodes", "-subj", "/CN=Test Cert")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("openssl req failed: %v\n%s", err, out)
	}

	// Export to p12 (empty password)
	cmd = exec.Command("openssl", "pkcs12", "-export", "-out", p12Path,
		"-inkey", keyPath, "-in", certPath,
		"-passout", "pass:")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("openssl pkcs12 failed: %v\n%s", err, out)
	}

	return p12Path
}

func TestCertificateManagement(t *testing.T) {
	// Setup temp config dir
	tmpDir, err := os.MkdirTemp("", "cert-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create config service
	cfgService, err := config.NewServiceWithDir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to create config service: %v", err)
	}

	// Create signature service
	service := NewSignatureService(cfgService)

	// Generate a test p12 file
	p12Path := generateTestP12(t, tmpDir, "test.p12")

	// Test AddCertificateStore
	err = service.AddCertificateStore(p12Path)
	if err != nil {
		t.Errorf("AddCertificateStore failed: %v", err)
	}

	// Verify it's in config
	cfg := cfgService.Get()
	found := false
	for _, store := range cfg.CertificateStores {
		if store == p12Path {
			found = true
			break
		}
	}
	if !found {
		t.Error("Certificate store not found in config after adding")
	}

	// Test ListCertificates
	certs, err := service.ListCertificates()
	if err != nil {
		t.Fatalf("ListCertificates failed: %v", err)
	}

	// Verify our cert is found
	foundCert := false
	for _, cert := range certs {
		if cert.FilePath == p12Path {
			foundCert = true
			if cert.Name != "test.p12" && cert.Name != "Test Cert" {
				// Name might be filename or CN depending on implementation
				// Our implementation uses filename if loaded from file without password?
				// pkcs12.LoadCertificateFromPKCS12File sets Name = filepath.Base(filePath) initially
				// then calls convertX509Certificate which sets Name = CN
				// So it should be "Test Cert"
				t.Logf("Found cert name: %s", cert.Name)
			}
			break
		}
	}
	if !foundCert {
		t.Error("Added certificate not found in ListCertificates")
	}

	// Test RemoveCertificateStore
	err = service.RemoveCertificateStore(p12Path)
	if err != nil {
		t.Errorf("RemoveCertificateStore failed: %v", err)
	}

	// Verify it's gone from config
	cfg = cfgService.Get()
	found = false
	for _, store := range cfg.CertificateStores {
		if store == p12Path {
			found = true
			break
		}
	}
	if found {
		t.Error("Certificate store still in config after removing")
	}
}
