package signature

import (
	"path/filepath"
	"strings"

	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
)

// CertificateFilter defines criteria for filtering certificates
type CertificateFilter struct {
	Source      string // Filter by source (system, user, pkcs11)
	Search      string // Search in name, subject, issuer
	ValidOnly   bool   // Only return valid (non-expired) certificates
	IncludeCA   bool   // Include CA certificates
	MinKeyUsage string // Require specific key usage (e.g., "digitalSignature")
}

func (s *SignatureService) ListCertificates() ([]Certificate, error) {
	return s.ListCertificatesFiltered(CertificateFilter{})
}

// ListCertificatesFiltered returns certificates matching the filter criteria
func (s *SignatureService) ListCertificatesFiltered(filter CertificateFilter) ([]Certificate, error) {
	var allCerts []Certificate
	seenFingerprints := make(map[string]bool)

	// Load certificates from configured stores only
	if s.configService != nil {
		cfg := s.configService.Get()

		// Load from certificate stores
		for _, storePath := range cfg.CertificateStores {
			storeCerts, err := pkcs12.LoadCertificatesFromPath(storePath)
			if err == nil {
				for _, sc := range storeCerts {
					cert := Certificate{
						Name:         sc.Name,
						Issuer:       sc.Issuer,
						Subject:      sc.Subject,
						SerialNumber: sc.SerialNumber,
						ValidFrom:    sc.ValidFrom,
						ValidTo:      sc.ValidTo,
						Fingerprint:  sc.Fingerprint,
						Source:       sc.Source,
						KeyUsage:     sc.KeyUsage,
						IsValid:      sc.IsValid,
						FilePath:     sc.FilePath,
						RequiresPin:  sc.RequiresPin,
						PinOptional:  sc.PinOptional,
					}

					if sc.FilePath != "" {
						ext := strings.ToLower(filepath.Ext(sc.FilePath))
						inNSSDB := strings.Contains(sc.FilePath, ".pki/nssdb")

						if ext == ".p12" || ext == ".pfx" {
							cert.CanSign = true
							requiresPin, err := pkcs12.CheckPKCS12RequiresPassword(sc.FilePath)
							if err == nil {
								cert.RequiresPin = requiresPin
								cert.PinOptional = !requiresPin
							} else {
								cert.RequiresPin = true
								cert.PinOptional = false
							}
						} else if inNSSDB {
							cert.CanSign = true
							cert.Source = "NSS Database"
							cert.RequiresPin = false
							cert.PinOptional = true
						}
					}
					allCerts = append(allCerts, cert)
				}
			}
		}

		// Load from token libraries (PKCS#11)
		pkcs11Certs, err := pkcs11.LoadCertificatesFromModules(cfg.TokenLibraries)
		if err == nil {
			for _, pc := range pkcs11Certs {
				allCerts = append(allCerts, Certificate{
					Name:         pc.Name,
					Issuer:       pc.Issuer,
					Subject:      pc.Subject,
					SerialNumber: pc.SerialNumber,
					ValidFrom:    pc.ValidFrom,
					ValidTo:      pc.ValidTo,
					Fingerprint:  pc.Fingerprint,
					Source:       pc.Source,
					KeyUsage:     pc.KeyUsage,
					IsValid:      pc.IsValid,
					PKCS11Module: pc.PKCS11Module,
					PKCS11URL:    pc.PKCS11URL,
					CanSign:      true,
					RequiresPin:  true,
					PinOptional:  false,
				})
			}
		}
	}

	var uniqueCerts []Certificate
	for _, cert := range allCerts {
		if !seenFingerprints[cert.Fingerprint] {
			seenFingerprints[cert.Fingerprint] = true

			if s.matchesFilter(cert, filter) {
				uniqueCerts = append(uniqueCerts, cert)
			}
		}
	}

	return uniqueCerts, nil
}

// SearchCertificates searches for certificates matching the query
func (s *SignatureService) SearchCertificates(query string) ([]Certificate, error) {
	return s.ListCertificatesFiltered(CertificateFilter{
		Search: query,
	})
}

func (s *SignatureService) matchesFilter(cert Certificate, filter CertificateFilter) bool {
	if filter.ValidOnly && !cert.IsValid {
		return false
	}

	if filter.Search != "" {
		searchLower := strings.ToLower(filter.Search)
		if !strings.Contains(strings.ToLower(cert.Name), searchLower) &&
			!strings.Contains(strings.ToLower(cert.Subject), searchLower) &&
			!strings.Contains(strings.ToLower(cert.Issuer), searchLower) &&
			!strings.Contains(strings.ToLower(cert.SerialNumber), searchLower) {
			return false
		}
	}

	if filter.MinKeyUsage != "" {
		hasRequiredUsage := false
		for _, usage := range cert.KeyUsage {
			if strings.EqualFold(usage, filter.MinKeyUsage) {
				hasRequiredUsage = true
				break
			}
		}
		if !hasRequiredUsage {
			return false
		}
	}

	return true
}
