package signature

import (
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/ferran/pdf_app/internal/signature/certutil"
	"github.com/ferran/pdf_app/internal/signature/nss"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
	"github.com/ferran/pdf_app/internal/signature/types"
)

// CertificateFilter defines criteria for filtering certificates
type CertificateFilter struct {
	Source           string // Filter by source (system, user, pkcs11)
	Search           string // Search in name, subject, issuer
	ValidOnly        bool   // Only return valid (non-expired) certificates
	RequiredKeyUsage string // Require specific key usage (e.g., "digitalSignature")
}

func (s *SignatureService) ListCertificates() ([]types.Certificate, error) {
	return s.ListCertificatesFiltered(CertificateFilter{})
}

// ListCertificatesFiltered returns certificates matching the filter criteria
func (s *SignatureService) ListCertificatesFiltered(filter CertificateFilter) ([]types.Certificate, error) {
	var allCerts []types.Certificate
	seenFingerprints := make(map[string]bool)

	// Load certificates from configured stores only
	if s.configService != nil {
		cfg := s.configService.Get()

		// Load from certificate stores
		for _, storePath := range cfg.CertificateStores {
			storeCerts, err := pkcs12.LoadCertificatesFromPath(storePath)
			if err == nil {
				for _, sc := range storeCerts {
					if sc.FilePath != "" {
						ext := strings.ToLower(filepath.Ext(sc.FilePath))
						inNSSDB := strings.Contains(sc.FilePath, ".pki/nssdb")

						if ext == ".p12" || ext == ".pfx" {
							allCerts = append(allCerts, sc)
						} else if !inNSSDB {
							allCerts = append(allCerts, sc)
						}
					} else {
						allCerts = append(allCerts, sc)
					}
				}
			}
		}

		// Load from token libraries (PKCS#11)
		pkcs11Certs, err := pkcs11.LoadCertificatesFromModules(cfg.TokenLibraries)
		if err != nil {
			slog.Warn("failed to load PKCS#11 certificates", "error", err)
		} else {
			allCerts = append(allCerts, pkcs11Certs...)
		}
	}

	nssCerts, err := LoadNSSCertificates()
	if err != nil {
		slog.Warn("failed to load NSS certificates", "error", err)
	} else {
		allCerts = append(allCerts, nssCerts...)
	}

	uniqueCerts := make([]types.Certificate, 0, len(allCerts))
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
func (s *SignatureService) SearchCertificates(query string) ([]types.Certificate, error) {
	return s.ListCertificatesFiltered(CertificateFilter{
		Search: query,
	})
}

// matchesFilter checks if a certificate matches the given filter criteria
func (s *SignatureService) matchesFilter(cert types.Certificate, filter CertificateFilter) bool {
	if filter.ValidOnly && !cert.IsValid {
		return false
	}

	if filter.Source != "" && !strings.EqualFold(cert.Source, filter.Source) {
		return false
	}

	if filter.Search != "" {
		searchLower := strings.ToLower(filter.Search)
		nameLower := strings.ToLower(cert.Name)
		subjectLower := strings.ToLower(cert.Subject)
		issuerLower := strings.ToLower(cert.Issuer)
		serialLower := strings.ToLower(cert.SerialNumber)

		if !strings.Contains(nameLower, searchLower) &&
			!strings.Contains(subjectLower, searchLower) &&
			!strings.Contains(issuerLower, searchLower) &&
			!strings.Contains(serialLower, searchLower) {
			return false
		}
	}

	if filter.RequiredKeyUsage != "" {
		found := false
		for _, usage := range cert.KeyUsage {
			if strings.EqualFold(usage, filter.RequiredKeyUsage) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	return true
}

// LoadNSSCertificates loads certificates from NSS database using NSS APIs
func LoadNSSCertificates() ([]types.Certificate, error) {
	nssCerts, err := nss.ListCertificates()
	if err != nil {
		return nil, err
	}

	var certs []types.Certificate
	for _, nc := range nssCerts {
		if !nc.HasPrivateKey {
			continue
		}

		c := certutil.ConvertX509Certificate(nc.X509Cert, "NSS Database", nc.X509Cert.Subject.CommonName)
		c.NSSNickname = nc.Nickname
		c.RequiresPin = false
		c.PinOptional = true

		certs = append(certs, c)
	}

	return certs, nil
}
