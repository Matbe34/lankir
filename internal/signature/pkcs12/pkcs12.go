package pkcs12

import (
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	goPkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Certificate represents a digital certificate with metadata
type Certificate struct {
	Name         string   `json:"name"`
	Issuer       string   `json:"issuer"`
	Subject      string   `json:"subject"`
	SerialNumber string   `json:"serialNumber"`
	ValidFrom    string   `json:"validFrom"`
	ValidTo      string   `json:"validTo"`
	Fingerprint  string   `json:"fingerprint"`
	Source       string   `json:"source"`
	KeyUsage     []string `json:"keyUsage"`
	IsValid      bool     `json:"isValid"`
	FilePath     string   `json:"filePath,omitempty"`
}

// Signer implements crypto.Signer for PKCS#12 files
type Signer struct {
	cert       *x509.Certificate
	privateKey crypto.PrivateKey
}

func (ps *Signer) Public() crypto.PublicKey {
	if signer, ok := ps.privateKey.(crypto.Signer); ok {
		return signer.Public()
	}
	return nil
}

func (ps *Signer) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	if signer, ok := ps.privateKey.(crypto.Signer); ok {
		return signer.Sign(rand, digest, opts)
	}
	return nil, fmt.Errorf("private key does not implement crypto.Signer")
}

func (ps *Signer) Certificate() *x509.Certificate {
	return ps.cert
}

// LoadCertificatesFromSystemStore loads certificates from system certificate store
// On Linux, this typically includes /etc/ssl/certs and similar locations
func LoadCertificatesFromSystemStore() ([]Certificate, error) {
	var certs []Certificate

	// Common system certificate directories on Linux
	certDirs := []string{
		"/etc/ssl/certs",
		"/etc/pki/tls/certs",
		"/usr/share/ca-certificates",
	}

	for _, dir := range certDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		dirCerts, err := loadCertificatesFromDirectory(dir, "system")
		if err == nil {
			certs = append(certs, dirCerts...)
		}
	}

	return certs, nil
}

// LoadCertificatesFromUserStore loads certificates from user's certificate store
// On Linux, this includes common user certificate locations
func LoadCertificatesFromUserStore() ([]Certificate, error) {
	var certs []Certificate

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return certs, err
	}

	// Common user certificate directories
	certDirs := []string{
		filepath.Join(homeDir, ".pki", "nssdb"),
		filepath.Join(homeDir, ".mozilla", "certificates"),
		filepath.Join(homeDir, ".config", "certificates"),
		filepath.Join(homeDir, "certificates"),
	}

	for _, dir := range certDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		dirCerts, err := loadCertificatesFromDirectory(dir, "user")
		if err == nil {
			certs = append(certs, dirCerts...)
		}
	}

	return certs, nil
}

// loadCertificatesFromDirectory loads certificates from a directory
func loadCertificatesFromDirectory(dir string, source string) ([]Certificate, error) {
	var certs []Certificate

	entries, err := os.ReadDir(dir)
	if err != nil {
		return certs, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filePath := filepath.Join(dir, entry.Name())
		fileName := entry.Name()

		// Check for certificate file extensions
		ext := strings.ToLower(filepath.Ext(fileName))
		if ext == ".crt" || ext == ".cer" || ext == ".pem" || ext == ".p12" || ext == ".pfx" {
			// Handle PKCS#12 files differently
			if ext == ".p12" || ext == ".pfx" {
				// PKCS#12 files require password, skip for listing
				// They will be handled separately when signing
				continue
			}

			// Read and parse the certificate
			data, err := os.ReadFile(filePath)
			if err != nil {
				continue
			}

			cert, err := parseCertificate(data)
			if err != nil {
				continue
			}

			if isCertificateValidForSigning(cert) {
				c := convertX509Certificate(cert, source, fileName)
				c.FilePath = filePath
				certs = append(certs, c)
			}
		}
	}

	return certs, nil
}

// parseCertificate attempts to parse a certificate from various formats
func parseCertificate(data []byte) (*x509.Certificate, error) {
	// Try DER format first
	cert, err := x509.ParseCertificate(data)
	if err == nil {
		return cert, nil
	}

	// Try PEM format
	block, _ := pem.Decode(data)
	if block != nil {
		return x509.ParseCertificate(block.Bytes)
	}

	return nil, fmt.Errorf("failed to parse certificate")
}

// CheckPKCS12RequiresPassword checks if a PKCS#12 file requires a password
// Returns: requiresPassword, canOpenWithoutPassword, error
func CheckPKCS12RequiresPassword(filePath string) (bool, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return true, fmt.Errorf("failed to read PKCS#12 file: %w", err)
	}

	// Try to decode with empty password
	_, _, _, err = goPkcs12.DecodeChain(data, "")
	if err == nil {
		// Successfully decoded with empty password
		return false, nil
	}

	// Check if it's a password error or a structural error
	// If it's a password error, the file requires a password
	// If it's a structural error, the file might be corrupted
	errStr := err.Error()
	if strings.Contains(errStr, "pkcs12: expected exactly two safe bags") ||
		strings.Contains(errStr, "incorrect password") ||
		strings.Contains(errStr, "decryption password incorrect") ||
		strings.Contains(errStr, "MAC verification failed") {
		return true, nil
	}

	// For other errors, assume password is required
	return true, nil
}

// GetSignerFromPKCS12File loads a signer from a PKCS#12 file with password
func GetSignerFromPKCS12File(filePath string, password string) (*Signer, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read PKCS#12 file: %w", err)
	}

	privateKey, cert, _, err := goPkcs12.DecodeChain(data, password)
	if err != nil {
		return nil, fmt.Errorf("failed to decode PKCS#12 file: %w", err)
	}

	if cert == nil {
		return nil, fmt.Errorf("no certificate found in PKCS#12 file")
	}

	if privateKey == nil {
		return nil, fmt.Errorf("no private key found in PKCS#12 file")
	}

	return &Signer{
		cert:       cert,
		privateKey: privateKey,
	}, nil
}

// isCertificateValidForSigning checks if a certificate can be used for signing
func isCertificateValidForSigning(cert *x509.Certificate) bool {
	// Check if certificate has digital signature key usage
	if cert.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return false
	}

	// Optionally filter out CA certificates
	if cert.IsCA {
		return false
	}

	return true
}

// convertX509Certificate converts x509.Certificate to our Certificate type
func convertX509Certificate(cert *x509.Certificate, source string, filename string) Certificate {
	var keyUsage []string
	if cert.KeyUsage&x509.KeyUsageDigitalSignature != 0 {
		keyUsage = append(keyUsage, "Digital Signature")
	}
	if cert.KeyUsage&x509.KeyUsageContentCommitment != 0 {
		keyUsage = append(keyUsage, "Non Repudiation")
	}
	if cert.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
		keyUsage = append(keyUsage, "Key Encipherment")
	}

	// Get certificate name (CN from subject)
	name := cert.Subject.CommonName
	if name == "" && filename != "" {
		name = filepath.Base(filename)
	}
	if name == "" {
		name = "Unknown Certificate"
	}

	// Calculate SHA-256 fingerprint
	hash := sha256.Sum256(cert.Raw)
	fingerprint := hex.EncodeToString(hash[:])

	// Check if certificate is currently valid
	now := time.Now()
	isValid := now.After(cert.NotBefore) && now.Before(cert.NotAfter)

	return Certificate{
		Name:         name,
		Issuer:       cert.Issuer.CommonName,
		Subject:      cert.Subject.CommonName,
		SerialNumber: cert.SerialNumber.String(),
		ValidFrom:    cert.NotBefore.Format("2006-01-02 15:04:05"),
		ValidTo:      cert.NotAfter.Format("2006-01-02 15:04:05"),
		Fingerprint:  fingerprint,
		Source:       source,
		KeyUsage:     keyUsage,
		IsValid:      isValid,
	}
}
