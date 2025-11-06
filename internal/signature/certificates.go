package signature

import (
	"fmt"
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

	// Load system certificates
	if filter.Source == "" || filter.Source == "system" {
		systemCerts, err := pkcs12.LoadCertificatesFromSystemStore()
		if err != nil {
			fmt.Printf("Error loading system certificates: %v\n", err)
		} else {
			// Convert pkcs12.Certificate to signature.Certificate
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
				}
				// Check if this is a PKCS#12 file (has private key)
				if sc.FilePath != "" {
					ext := strings.ToLower(filepath.Ext(sc.FilePath))
					cert.CanSign = (ext == ".p12" || ext == ".pfx")
				}
				allCerts = append(allCerts, cert)
			}
		}
	}

	// Load user certificates from common locations
	if filter.Source == "" || filter.Source == "user" {
		userCerts, err := pkcs12.LoadCertificatesFromUserStore()
		if err != nil {
			fmt.Printf("Error loading user certificates: %v\n", err)
		} else {
			// Convert pkcs12.Certificate to signature.Certificate
			for _, uc := range userCerts {
				// Check if this cert has a private key in NSS database
				hasNSSKey := s.checkNSSPrivateKey(uc.Fingerprint)

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
				}

				// Check if this is a PKCS#12 file (has private key)
				if uc.FilePath != "" {
					ext := strings.ToLower(filepath.Ext(uc.FilePath))
					// Check if it's a PKCS#12 file OR in NSS database directory
					inNSSDB := strings.Contains(uc.FilePath, ".pki/nssdb")
					cert.CanSign = (ext == ".p12" || ext == ".pfx") || hasNSSKey || inNSSDB
					if hasNSSKey {
						cert.Source = "NSS Database"
					}
					if inNSSDB && !hasNSSKey {
						cert.Source = "NSS Database"
						// Store NSS nickname from certutil output
						cert.NSSNickname = s.getNSSNickname(uc.Fingerprint)
					}
				} else {
					cert.CanSign = hasNSSKey
					if hasNSSKey {
						cert.Source = "NSS Database"
					}
				}
				allCerts = append(allCerts, cert)
			}
		}
	}

	// Load PKCS#11 certificates from smart cards/tokens
	if filter.Source == "" || filter.Source == "pkcs11" {
		pkcs11Certs, err := pkcs11.LoadCertificates()
		if err != nil {
			fmt.Printf("Error loading PKCS#11 certificates: %v\n", err)
		} else {
			// Convert pkcs11.Certificate to signature.Certificate
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
					CanSign:      true, // PKCS#11 tokens always have private keys
				})
			}
		}
	}

	// Deduplicate certificates by fingerprint
	var uniqueCerts []Certificate
	for _, cert := range allCerts {
		if !seenFingerprints[cert.Fingerprint] {
			seenFingerprints[cert.Fingerprint] = true

			// Apply filters
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

// matchesFilter checks if a certificate matches the filter criteria
func (s *SignatureService) matchesFilter(cert Certificate, filter CertificateFilter) bool {
	// Check validity
	if filter.ValidOnly && !cert.IsValid {
		return false
	}

	// Check search query
	if filter.Search != "" {
		searchLower := strings.ToLower(filter.Search)
		if !strings.Contains(strings.ToLower(cert.Name), searchLower) &&
			!strings.Contains(strings.ToLower(cert.Subject), searchLower) &&
			!strings.Contains(strings.ToLower(cert.Issuer), searchLower) &&
			!strings.Contains(strings.ToLower(cert.SerialNumber), searchLower) {
			return false
		}
	}

	// Check key usage requirement
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

// checkNSSPrivateKey checks if a certificate has a private key in NSS database
func (s *SignatureService) checkNSSPrivateKey(fingerprint string) bool {
	// Always return false - we check this at runtime via PKCS#11
	// Certificates in .pki/nssdb are marked as NSS Database based on path
	return false
}

// getNSSNickname gets the NSS nickname for a certificate by matching serial number
func (s *SignatureService) getNSSNickname(fingerprint string) string {
	// For now, try common pattern - extract from cert file
	// Real implementation would parse NSS database
	// Return empty to use filename as fallback
	return ""
}
