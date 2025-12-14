package pkcs12

import (
	"crypto"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ferran/pdf_app/internal/signature/certutil"
	goPkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Certificate represents a digital certificate with metadata
// This is an alias for the main signature.Certificate type to avoid circular imports
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
	CanSign      bool     `json:"canSign"`
	RequiresPin  bool     `json:"requiresPin"`
	PinOptional  bool     `json:"pinOptional"`
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

// DefaultSystemCertDirs contains common system certificate directories on Linux
var DefaultSystemCertDirs = []string{
	"/etc/ssl/certs",
}

// LoadCertificatesFromSystemStore loads certificates from system certificate store
// On Linux, this typically includes /etc/ssl/certs and similar locations
func LoadCertificatesFromSystemStore() ([]Certificate, error) {
	var certs []Certificate

	for _, dir := range DefaultSystemCertDirs {
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

// DefaultUserCertDirs contains common user certificate directories
var DefaultUserCertDirs = []string{
	".pki/nssdb",
}

// LoadCertificatesFromUserStore loads certificates from user's certificate store
// On Linux, this includes common user certificate locations
func LoadCertificatesFromUserStore() ([]Certificate, error) {
	var certs []Certificate

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return certs, err
	}

	for _, relDir := range DefaultUserCertDirs {
		dir := filepath.Join(homeDir, relDir)
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
// Returns: requiresPassword, error
func CheckPKCS12RequiresPassword(filePath string) (bool, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return false, fmt.Errorf("failed to read file: %w", err)
	}

	// Try to decode with empty password
	_, _, _, err = goPkcs12.DecodeChain(data, "")
	if err == nil {
		// Successfully decoded with empty password
		return false, nil
	}

	// Analyze error to distinguish between password errors and structural errors
	errStr := strings.ToLower(err.Error())

	// Password-related errors indicate the file is valid but needs a password
	passwordErrors := []string{
		"password",
		"mac verification",
		"decryption",
		"authentication",
	}

	for _, passwordErr := range passwordErrors {
		if strings.Contains(errStr, passwordErr) {
			return true, nil
		}
	}

	// Structural errors indicate invalid/corrupted file
	structuralErrors := []string{
		"expected",
		"invalid",
		"malformed",
		"corrupt",
		"bad",
		"parse",
		"decode",
		"asn1",
	}

	for _, structErr := range structuralErrors {
		if strings.Contains(errStr, structErr) {
			return false, fmt.Errorf("invalid PKCS12 file: %w", err)
		}
	}

	// Unknown error - be conservative and assume password required
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
	data := certutil.ConvertX509Certificate(cert, source, filename)
	return Certificate{
		Name:         data.Name,
		Issuer:       data.Issuer,
		Subject:      data.Subject,
		SerialNumber: data.SerialNumber,
		ValidFrom:    data.ValidFrom,
		ValidTo:      data.ValidTo,
		Fingerprint:  data.Fingerprint,
		Source:       data.Source,
		KeyUsage:     data.KeyUsage,
		IsValid:      data.IsValid,
		CanSign:      data.CanSign,
	}
}

// LoadCertificateFromPKCS12File loads certificate metadata from a PKCS#12 file
// If the file requires a password, it returns a certificate with basic info and RequiresPin=true
func LoadCertificateFromPKCS12File(filePath string) (*Certificate, error) {
	name := filepath.Base(filePath)

	cert := &Certificate{
		Name:     name,
		FilePath: filePath,
		Source:   "User File",
	}

	// Check if we can open it without password
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	privateKey, x509Cert, _, err := goPkcs12.DecodeChain(data, "")
	if err == nil && x509Cert != nil {
		// We can read it!
		c := convertX509Certificate(x509Cert, "User File", name)
		c.FilePath = filePath
		// If we have private key, it can sign
		if privateKey != nil {
			// It technically doesn't require PIN if we opened it with empty string,
			// but usually we treat empty password as "no PIN".
			// However, for consistency with other parts, let's see.
		}
		return &c, nil
	}

	// If we can't open it, assume it requires PIN
	// We can't get details, but we return the file info
	cert.RequiresPin = true
	// We mark it as valid for listing purposes, but it can't be used without PIN
	cert.IsValid = true

	return cert, nil
}

// LoadCertificatesFromPath loads certificates from a file or directory
func LoadCertificatesFromPath(path string) ([]Certificate, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	if info.IsDir() {
		return loadCertificatesFromDirectory(path, "User Store")
	}

	// It's a file
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".p12" || ext == ".pfx" {
		cert, err := LoadCertificateFromPKCS12File(path)
		if err != nil {
			return nil, err
		}
		if cert != nil {
			return []Certificate{*cert}, nil
		}
		return nil, nil
	}

	// Try loading as normal cert
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	cert, err := parseCertificate(data)
	if err != nil {
		return nil, err
	}

	if isCertificateValidForSigning(cert) {
		c := convertX509Certificate(cert, "User File", filepath.Base(path))
		c.FilePath = path
		return []Certificate{c}, nil
	}

	return nil, nil
}
