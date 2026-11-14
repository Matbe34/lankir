package pkcs12

import (
	"crypto"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/platform"
	"github.com/Matbe34/lankir/internal/signature/types"
	goPkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Signer implements crypto.Signer for PKCS#12 files
type Signer struct {
	cert       *x509.Certificate
	caCerts    []*x509.Certificate
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

// CACertificates returns the other certificates in the file, usually the issuing chain.
func (ps *Signer) CACertificates() []*x509.Certificate {
	return ps.caCerts
}

// DefaultSystemCertDirs uses platform-specific system certificate directories
var DefaultSystemCertDirs = platform.DefaultSystemCertDirs

// DefaultUserCertDirs uses platform-specific user certificate directories (relative to home)
var DefaultUserCertDirs = platform.DefaultUserCertDirs

// LoadCertificatesFromSystemStore loads certificates from system certificate store.
func LoadCertificatesFromSystemStore() ([]types.Certificate, error) {
	var certs []types.Certificate

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

// LoadCertificatesFromUserStore loads certificates from user's certificate store.
func LoadCertificatesFromUserStore() ([]types.Certificate, error) {
	var certs []types.Certificate

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
func loadCertificatesFromDirectory(dir string, source string) ([]types.Certificate, error) {
	var certs []types.Certificate

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
				cert, err := LoadCertificateFromPKCS12File(filePath)
				if err == nil && cert != nil {
					certs = append(certs, *cert)
				}
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

			if certutil.IsCertificateValidForSigning(cert) {
				c := certutil.ConvertX509Certificate(cert, source, fileName)
				c.FilePath = filePath
				c.CanSign = false // a bare certificate file has no private key
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

// GetSignerFromPKCS12File loads a signer from a PKCS#12 file with password
func GetSignerFromPKCS12File(filePath string, password string) (*Signer, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read PKCS#12 file: %w", err)
	}

	privateKey, cert, caCerts, err := goPkcs12.DecodeChain(data, password)
	if errors.Is(err, goPkcs12.ErrIncorrectPassword) {
		return nil, fmt.Errorf("cannot open %s: %w", filepath.Base(filePath), types.ErrIncorrectPIN)
	}
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
		caCerts:    caCerts,
		privateKey: privateKey,
	}, nil
}

// CACertificates are the certificates besides the key's own in a PKCS#12 file
// that opens without a password, usually its issuing chain.
func CACertificates(filePath string) []*x509.Certificate {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}
	_, _, caCerts, err := goPkcs12.DecodeChain(data, "")
	if err != nil {
		return nil
	}
	return caCerts
}

// LoadCertificateFromPKCS12File loads certificate metadata from a PKCS#12 file
// If the file requires a password, it returns a certificate with basic info and RequiresPin=true
func LoadCertificateFromPKCS12File(filePath string) (*types.Certificate, error) {
	name := filepath.Base(filePath)

	cert := &types.Certificate{
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
		c := certutil.ConvertX509Certificate(x509Cert, "User File", name)
		c.FilePath = filePath
		// If we have private key, it can sign
		if privateKey != nil {
			// It technically doesn't require PIN if we opened it with empty string,
			// but usually we treat empty password as "no PIN".
			// However, for consistency with other parts, let's see.
			c.RequiresPin = false
			c.PinOptional = true
		}
		return &c, nil
	}
	if !errors.Is(err, goPkcs12.ErrIncorrectPassword) {
		slog.Warn("skipping unreadable PKCS#12 file", "file", filePath, "error", err)
		return nil, fmt.Errorf("cannot read %s: %w", name, err)
	}

	// Locked: the certificate can't be read until signing supplies the
	// password, which then checks validity and key usage. The path stands in
	// for the fingerprint so the file can be selected and remembered.
	cert.Fingerprint = "file:" + filePath
	cert.RequiresPin = true
	cert.CanSign = true
	cert.IsValid = true

	return cert, nil
}

// LoadCertificatesFromPath loads certificates from a file or directory
func LoadCertificatesFromPath(path string) ([]types.Certificate, error) {
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
			return []types.Certificate{*cert}, nil
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

	if certutil.IsCertificateValidForSigning(cert) {
		c := certutil.ConvertX509Certificate(cert, "User File", filepath.Base(path))
		c.FilePath = path
		c.CanSign = false // a bare certificate file has no private key
		return []types.Certificate{c}, nil
	}

	return nil, nil
}
