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
	PKCS11Module string   `json:"pkcs11Module,omitempty"`
	PKCS11URL    string   `json:"pkcs11Url,omitempty"`
}

// LoadCertificates loads certificates from PKCS#11 tokens (smart cards, USB tokens)
func LoadCertificates() ([]Certificate, error) {
	var certs []Certificate

	// Load from individual modules
	modules := []string{
		// Smart cards and tokens (these work directly)
		"/usr/lib/libbit4xpki.so",
		"/usr/lib/libbit4ipki.so",
		"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
		"/usr/lib/opensc-pkcs11.so",
		"/usr/lib/pkcs11/opensc-pkcs11.so",
	}

	for _, modulePath := range modules {
		if _, err := os.Stat(modulePath); os.IsNotExist(err) {
			continue
		}

		moduleCerts, err := loadCertificatesFromModule(modulePath)
		if err == nil {
			certs = append(certs, moduleCerts...)
		}
	}

	// Add NSS database certificates
	nssCerts, err := loadNSSCertificates()
	if err == nil {
		fmt.Printf("NSS loader found %d certificates\n", len(nssCerts))
		certs = append(certs, nssCerts...)
	} else {
		fmt.Printf("NSS loader error: %v\n", err)
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

	// Get list of slots
	slots, err := p.GetSlotList(true) // true = only slots with tokens present
	if err != nil {
		return certs, fmt.Errorf("failed to get slot list: %w", err)
	}

	for _, slot := range slots {
		// Get token info
		tokenInfo, err := p.GetTokenInfo(slot)
		if err != nil {
			continue
		}

		// Open session
		session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION)
		if err != nil {
			continue
		}

		// Find all certificate objects
		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			p.CloseSession(session)
			continue
		}

		// Get certificate objects
		objs, _, err := p.FindObjects(session, 100)
		if err != nil {
			p.FindObjectsFinal(session)
			p.CloseSession(session)
			continue
		}
		p.FindObjectsFinal(session)

		// Process each certificate
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

			// Parse the certificate
			cert, err := x509.ParseCertificate(certDER)
			if err != nil {
				continue
			}

			if isCertificateValidForSigning(cert) {
				// Clean up label (remove null bytes)
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

// loadNSSCertificates loads certificates from NSS database (~/.pki/nssdb)
func loadNSSCertificates() ([]Certificate, error) {
	var certs []Certificate

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return certs, fmt.Errorf("failed to get home directory: %w", err)
	}

	nssDBPath := filepath.Join(homeDir, ".pki", "nssdb")

	// Check if NSS database exists
	if _, err := os.Stat(nssDBPath); os.IsNotExist(err) {
		return certs, nil // NSS database doesn't exist, not an error
	}

	// Try common NSS PKCS#11 module paths
	nssModulePaths := []string{
		"/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so", // Use p11-kit which auto-discovers NSS
		"/usr/lib/x86_64-linux-gnu/nss/libsoftokn3.so",
		"/usr/lib64/libsoftokn3.so",
		"/usr/lib/libsoftokn3.so",
		"/usr/lib/firefox/libsoftokn3.so",
	}

	for _, modulePath := range nssModulePaths {
		if _, err := os.Stat(modulePath); os.IsNotExist(err) {
			continue
		}

		fmt.Printf("Trying NSS module: %s\n", modulePath)
		nssCerts, err := loadNSSCertificatesFromModule(modulePath, nssDBPath)
		if err != nil {
			fmt.Printf("Error from %s: %v\n", modulePath, err)
		}
		if len(nssCerts) > 0 {
			fmt.Printf("Found %d certs from %s\n", len(nssCerts), modulePath)
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

	// Get list of slots
	slots, err := p.GetSlotList(true)
	if err != nil {
		return certs, nil
	}

	fmt.Printf("Module %s has %d slots\n", modulePath, len(slots))

	for _, slot := range slots {
		// Get token info
		tokenInfo, err := p.GetTokenInfo(slot)
		if err != nil {
			continue
		}

		tokenLabel := strings.TrimSpace(tokenInfo.Label)
		fmt.Printf("Processing token: %s\n", tokenLabel)

		// Open session
		session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION)
		if err != nil {
			continue
		}

		// Try to login with empty password (NSS default)
		_ = p.Login(session, pkcs11.CKU_USER, "")

		// First, find all private keys to know which certificates are signable
		privateKeyMap := make(map[string]bool) // maps CKA_ID to true if private key exists

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
		}); err == nil {
			objs, _, err := p.FindObjects(session, 100)
			if err == nil {
				fmt.Printf("Found %d private keys\n", len(objs))
				for _, obj := range objs {
					attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
						pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
					})
					if err == nil && len(attrs) > 0 && len(attrs[0].Value) > 0 {
						keyID := hex.EncodeToString(attrs[0].Value)
						privateKeyMap[keyID] = true
						fmt.Printf("Private key ID: %s\n", keyID)
					}
				}
			}
			p.FindObjectsFinal(session)
		}

		// Now find all certificate objects
		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			p.CloseSession(session)
			continue
		}

		// Get certificate objects
		objs, _, err := p.FindObjects(session, 100)
		if err != nil {
			p.FindObjectsFinal(session)
			p.CloseSession(session)
			continue
		}
		p.FindObjectsFinal(session)

		// Process each certificate
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

			// Parse the certificate
			cert, err := x509.ParseCertificate(certDER)
			if err != nil {
				continue
			}

			// Check if this certificate has a corresponding private key
			keyID := hex.EncodeToString(certID)
			hasPrivateKey := privateKeyMap[keyID]

			// Only include certificates with private keys
			if !hasPrivateKey {
				continue
			}

			if isCertificateValidForSigning(cert) {
				// Clean up label (remove null bytes)
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
