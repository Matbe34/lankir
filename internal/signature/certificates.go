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

	if filter.Source == "" || filter.Source == "system" {
		systemCerts, err := pkcs12.LoadCertificatesFromSystemStore()
		if err == nil {
			for _, sc := range systemCerts {
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
					RequiresPin:  false,
					PinOptional:  false,
				}
				// Check if this is a PKCS#12 file (has private key)
				if sc.FilePath != "" {
					ext := strings.ToLower(filepath.Ext(sc.FilePath))
					if ext == ".p12" || ext == ".pfx" {
						cert.CanSign = true
						// Check if PIN/password is required
						requiresPin, err := pkcs12.CheckPKCS12RequiresPassword(sc.FilePath)
						if err == nil {
							cert.RequiresPin = requiresPin
							cert.PinOptional = !requiresPin
						} else {
							// If we can't check, assume PIN is required for safety
							cert.RequiresPin = true
							cert.PinOptional = false
						}
					}
				}
				allCerts = append(allCerts, cert)
			}
		}
	}

	if filter.Source == "" || filter.Source == "user" {
		userCerts, err := pkcs12.LoadCertificatesFromUserStore()
		if err == nil {
			for _, uc := range userCerts {
				cert := Certificate{
					Name:         uc.Name,
					Issuer:       uc.Issuer,
					Subject:      uc.Subject,
					SerialNumber: uc.SerialNumber,
					ValidFrom:    uc.ValidFrom,
					ValidTo:      uc.ValidTo,
					Fingerprint:  uc.Fingerprint,
					Source:       uc.Source,
					KeyUsage:     uc.KeyUsage,
					IsValid:      uc.IsValid,
					FilePath:     uc.FilePath,
					RequiresPin:  false,
					PinOptional:  false,
				}

				if uc.FilePath != "" {
					ext := strings.ToLower(filepath.Ext(uc.FilePath))
					inNSSDB := strings.Contains(uc.FilePath, ".pki/nssdb")

					if ext == ".p12" || ext == ".pfx" {
						cert.CanSign = true
						// Check if PIN/password is required
						requiresPin, err := pkcs12.CheckPKCS12RequiresPassword(uc.FilePath)
						if err == nil {
							cert.RequiresPin = requiresPin
							cert.PinOptional = !requiresPin
						} else {
							// If we can't check, assume PIN is required for safety
							cert.RequiresPin = true
							cert.PinOptional = false
						}
					} else if inNSSDB {
						cert.CanSign = true
						cert.Source = "User NSS DB"
						// NSS DB password is optional - try empty first
						cert.RequiresPin = false
						cert.PinOptional = true
					}
				}
				allCerts = append(allCerts, cert)
			}
		}
	}

	if filter.Source == "" || filter.Source == "pkcs11" {
		pkcs11Certs, err := pkcs11.LoadCertificates()
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
