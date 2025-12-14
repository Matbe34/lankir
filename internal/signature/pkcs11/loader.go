package pkcs11

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/miekg/pkcs11"
)

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
	PKCS11Module string   `json:"pkcs11Module,omitempty"`
	PKCS11URL    string   `json:"pkcs11Url,omitempty"`
}

var DefaultModules = []string{
	"/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
	"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
}

// LoadCertificatesFromModules loads certificates from a list of PKCS#11 module paths
func LoadCertificatesFromModules(modulePaths []string) ([]Certificate, error) {
	var certs []Certificate

	for _, modulePath := range modulePaths {
		if err := validatePKCS11Module(modulePath); err != nil {
			continue
		}

		moduleCerts, err := loadCertificatesFromModule(modulePath)
		if err == nil {
			certs = append(certs, moduleCerts...)
		}
	}

	return certs, nil
}

// validatePKCS11Module validates that a PKCS#11 module file is safe to load
func validatePKCS11Module(modulePath string) error {
	fileInfo, err := os.Stat(modulePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("module does not exist")
		}
		return fmt.Errorf("failed to stat module: %w", err)
	}

	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("module is not a regular file (mode: %s)", fileInfo.Mode())
	}

	file, err := os.Open(modulePath)
	if err != nil {
		return fmt.Errorf("module is not readable: %w", err)
	}
	file.Close()

	const minModuleSize = 1024              // 1KB minimum
	const maxModuleSize = 200 * 1024 * 1024 // 200MB maximum

	if fileInfo.Size() < minModuleSize {
		return fmt.Errorf("module file too small (%d bytes, expected at least %d)",
			fileInfo.Size(), minModuleSize)
	}

	if fileInfo.Size() > maxModuleSize {
		return fmt.Errorf("module file too large (%d bytes, maximum %d)",
			fileInfo.Size(), maxModuleSize)
	}

	return nil
}

func LoadCertificates() ([]Certificate, error) {
	var certs []Certificate

	modules := []string{
		"/usr/lib/libpkcs11-dnie.so",
		"/usr/lib/libbit4xpki.so",
		"/usr/lib/libbit4ipki.so",
		"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
		"/usr/lib/opensc-pkcs11.so",
		"/usr/lib/pkcs11/opensc-pkcs11.so",
	}

	for _, modulePath := range modules {
		// Validate module file before attempting to load
		if err := validatePKCS11Module(modulePath); err != nil {
			continue
		}

		moduleCerts, err := loadCertificatesFromModule(modulePath)
		if err == nil {
			certs = append(certs, moduleCerts...)
		}
	}

	nssCerts, err := loadNSSCertificates()
	if err == nil {
		certs = append(certs, nssCerts...)
	}

	return certs, nil
}

// loadCertificatesFromModule loads certificates from a specific PKCS#11 module
func loadCertificatesFromModule(modulePath string) ([]Certificate, error) {
	var certs []Certificate

	p := pkcs11.New(modulePath)
	if p == nil {
		return certs, fmt.Errorf("failed to load PKCS#11 module: %s", modulePath)
	}
	defer p.Destroy()

	if err := p.Initialize(); err != nil {
		return certs, fmt.Errorf("failed to initialize PKCS#11 module: %w", err)
	}
	defer p.Finalize()

	slots, err := p.GetSlotList(true)
	if err != nil {
		return certs, fmt.Errorf("failed to get slot list: %w", err)
	}

	for _, slot := range slots {
		tokenInfo, err := p.GetTokenInfo(slot)
		if err != nil {
			continue
		}

		session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION)
		if err != nil {
			continue
		}

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			p.CloseSession(session)
			continue
		}

		objs, _, err := p.FindObjects(session, 100)
		if err != nil {
			p.FindObjectsFinal(session)
			p.CloseSession(session)
			continue
		}
		p.FindObjectsFinal(session)

		for _, obj := range objs {
			attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
				pkcs11.NewAttribute(pkcs11.CKA_LABEL, nil),
			})
			if err != nil {
				continue
			}

			var certDER []byte
			var labelBytes []byte

			for _, attr := range attrs {
				if attr.Type == pkcs11.CKA_VALUE {
					certDER = attr.Value
				} else if attr.Type == pkcs11.CKA_LABEL {
					labelBytes = attr.Value
				}
			}

			if len(certDER) == 0 {
				continue
			}

			cert, err := x509.ParseCertificate(certDER)
			if err != nil {
				continue
			}

			if isCertificateValidForSigning(cert) {
				label := strings.TrimRight(string(labelBytes), "\x00")

				c := convertX509Certificate(cert, "pkcs11", label)
				c.PKCS11Module = modulePath
				c.PKCS11URL = fmt.Sprintf("pkcs11:token=%s;object=%s",
					strings.TrimSpace(tokenInfo.Label), label)
				certs = append(certs, c)
			}
		}

		p.CloseSession(session)
	}

	return certs, nil
}

// isCertificateValidForSigning checks if a certificate can be used for signing
func isCertificateValidForSigning(cert *x509.Certificate) bool {
	if cert.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return false
	}

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

	name := cert.Subject.CommonName
	if name == "" && filename != "" {
		name = filepath.Base(filename)
	}
	if name == "" {
		name = "Unknown Certificate"
	}

	hash := sha256.Sum256(cert.Raw)
	fingerprint := hex.EncodeToString(hash[:])

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

// loadNSSCertificates loads certificates from NSS database (~/.pki/nssdb)
func loadNSSCertificates() ([]Certificate, error) {
	var certs []Certificate

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return certs, fmt.Errorf("failed to get home directory: %w", err)
	}

	nssDBPath := filepath.Join(homeDir, ".pki", "nssdb")

	if _, err := os.Stat(nssDBPath); os.IsNotExist(err) {
		return certs, nil // NSS database doesn't exist, not an error
	}

	nssModulePaths := []string{
		"/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so",
		"/usr/lib/x86_64-linux-gnu/nss/libsoftokn3.so",
		"/usr/lib64/libsoftokn3.so",
		"/usr/lib/libsoftokn3.so",
		"/usr/lib/firefox/libsoftokn3.so",
	}

	for _, modulePath := range nssModulePaths {
		if _, err := os.Stat(modulePath); os.IsNotExist(err) {
			continue
		}

		nssCerts, err := loadNSSCertificatesFromModule(modulePath, nssDBPath)
		if err == nil && len(nssCerts) > 0 {
			return nssCerts, nil
		}
	}

	return certs, nil
}

// loadNSSCertificatesFromModule loads certificates from NSS database using PKCS#11
func loadNSSCertificatesFromModule(modulePath string, nssDBPath string) ([]Certificate, error) {
	var certs []Certificate

	p := pkcs11.New(modulePath)
	if p == nil {
		return certs, nil
	}
	defer p.Destroy()

	if err := p.Initialize(); err != nil {
		return certs, nil
	}
	defer p.Finalize()

	slots, err := p.GetSlotList(true)
	if err != nil {
		return certs, nil
	}

	for _, slot := range slots {
		tokenInfo, err := p.GetTokenInfo(slot)
		if err != nil {
			continue
		}

		tokenLabel := strings.TrimSpace(tokenInfo.Label)

		session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION)
		if err != nil {
			continue
		}

		_ = p.Login(session, pkcs11.CKU_USER, "")

		privateKeyMap := make(map[string]bool)

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
		}); err == nil {
			objs, _, err := p.FindObjects(session, 100)
			if err == nil {
				for _, obj := range objs {
					attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
						pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
					})
					if err == nil && len(attrs) > 0 && len(attrs[0].Value) > 0 {
						keyID := hex.EncodeToString(attrs[0].Value)
						privateKeyMap[keyID] = true
					}
				}
			}
			p.FindObjectsFinal(session)
		}

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			p.CloseSession(session)
			continue
		}

		objs, _, err := p.FindObjects(session, 100)
		if err != nil {
			p.FindObjectsFinal(session)
			p.CloseSession(session)
			continue
		}
		p.FindObjectsFinal(session)

		for _, obj := range objs {
			attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
				pkcs11.NewAttribute(pkcs11.CKA_LABEL, nil),
				pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
			})
			if err != nil {
				continue
			}

			var certDER []byte
			var labelBytes []byte
			var certID []byte

			for _, attr := range attrs {
				if attr.Type == pkcs11.CKA_VALUE {
					certDER = attr.Value
				} else if attr.Type == pkcs11.CKA_LABEL {
					labelBytes = attr.Value
				} else if attr.Type == pkcs11.CKA_ID {
					certID = attr.Value
				}
			}

			if len(certDER) == 0 {
				continue
			}

			cert, err := x509.ParseCertificate(certDER)
			if err != nil {
				continue
			}

			keyID := hex.EncodeToString(certID)
			hasPrivateKey := privateKeyMap[keyID]

			if !hasPrivateKey {
				continue
			}

			if isCertificateValidForSigning(cert) {
				label := strings.TrimRight(string(labelBytes), "\x00")

				c := convertX509Certificate(cert, "NSS Database", label)
				c.PKCS11Module = modulePath
				c.PKCS11URL = fmt.Sprintf("pkcs11:token=%s;object=%s", tokenLabel, label)
				certs = append(certs, c)
			}
		}

		p.CloseSession(session)
	}

	return certs, nil
}
