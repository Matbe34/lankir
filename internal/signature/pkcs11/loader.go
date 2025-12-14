package pkcs11

import (
	"crypto/x509"
	"fmt"
	"os"
	"strings"

	"github.com/ferran/pdf_app/internal/signature/certutil"
	"github.com/ferran/pdf_app/internal/signature/types"
	"github.com/miekg/pkcs11"
)

var DefaultModules = []string{
	"/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
	"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
}

// LoadCertificatesFromModules loads certificates from a list of PKCS#11 module paths.
func LoadCertificatesFromModules(modulePaths []string) ([]types.Certificate, error) {
	var certs []types.Certificate

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

// validatePKCS11Module checks if a module file is safe to load.
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

// loadCertificatesFromModule loads certificates from a specific PKCS#11 module
func loadCertificatesFromModule(modulePath string) ([]types.Certificate, error) {
	var certs []types.Certificate

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

			if certutil.IsCertificateValidForSigning(cert) {
				label := strings.TrimRight(string(labelBytes), "\x00")

				c := certutil.ConvertX509Certificate(cert, "pkcs11", label)
				c.PKCS11Module = modulePath
				c.PKCS11URL = fmt.Sprintf("pkcs11:token=%s;object=%s",
					strings.TrimSpace(tokenInfo.Label), label)

				// PKCS#11 tokens usually require a PIN
				c.RequiresPin = true
				c.PinOptional = false

				certs = append(certs, c)
			}
		}

		p.CloseSession(session)
	}

	return certs, nil
}
