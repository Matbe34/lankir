package signature

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/ferran/pdf_app/internal/signature/nss"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
)

// CertificateFilter defines criteria for filtering certificates
type CertificateFilter struct {
	Source            string // Filter by source (system, user, pkcs11)
	Search            string // Search in name, subject, issuer
	ValidOnly         bool   // Only return valid (non-expired) certificates
	RequiredKeyUsage  string // Require specific key usage (e.g., "digitalSignature")
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
							allCerts = append(allCerts, cert)
						} else if !inNSSDB {
							allCerts = append(allCerts, cert)
						}
					} else {
						allCerts = append(allCerts, cert)
					}
				}
			}
		}

		// Load from token libraries (PKCS#11)
		pkcs11Certs, err := pkcs11.LoadCertificatesFromModules(cfg.TokenLibraries)
		if err != nil {
			slog.Warn("failed to load PKCS#11 certificates", "error", err)
		} else {
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

	nssCerts, err := LoadNSSCertificates()
	if err != nil {
		slog.Warn("failed to load NSS certificates", "error", err)
	} else {
		allCerts = append(allCerts, nssCerts...)
	}

	uniqueCerts := make([]Certificate, 0, len(allCerts))
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

// matchesFilter checks if a certificate matches the given filter criteria
func (s *SignatureService) matchesFilter(cert Certificate, filter CertificateFilter) bool {
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
func LoadNSSCertificates() ([]Certificate, error) {
	nssCerts, err := nss.ListCertificates()
	if err != nil {
		return nil, err
	}

	var certs []Certificate
	for _, nc := range nssCerts {
		if !nc.HasPrivateKey {
			continue
		}

		cert := nc.X509Cert
		fingerprint := sha256.Sum256(cert.Raw)
		fingerprintHex := hex.EncodeToString(fingerprint[:])

		isValid := time.Now().After(cert.NotBefore) && time.Now().Before(cert.NotAfter)

		var keyUsages []string
		if cert.KeyUsage&x509.KeyUsageDigitalSignature != 0 {
			keyUsages = append(keyUsages, "Digital Signature")
		}
		if cert.KeyUsage&x509.KeyUsageContentCommitment != 0 {
			keyUsages = append(keyUsages, "Non Repudiation")
		}
		if cert.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
			keyUsages = append(keyUsages, "Key Encipherment")
		}
		if cert.KeyUsage&x509.KeyUsageDataEncipherment != 0 {
			keyUsages = append(keyUsages, "Data Encipherment")
		}
		if cert.KeyUsage&x509.KeyUsageKeyAgreement != 0 {
			keyUsages = append(keyUsages, "Key Agreement")
		}
		if cert.KeyUsage&x509.KeyUsageCertSign != 0 {
			keyUsages = append(keyUsages, "Certificate Sign")
		}
		if cert.KeyUsage&x509.KeyUsageCRLSign != 0 {
			keyUsages = append(keyUsages, "CRL Sign")
		}
		if cert.KeyUsage&x509.KeyUsageEncipherOnly != 0 {
			keyUsages = append(keyUsages, "Encipher Only")
		}
		if cert.KeyUsage&x509.KeyUsageDecipherOnly != 0 {
			keyUsages = append(keyUsages, "Decipher Only")
		}

		canSign := (cert.KeyUsage&x509.KeyUsageDigitalSignature != 0) ||
			(cert.KeyUsage&x509.KeyUsageContentCommitment != 0)

		certs = append(certs, Certificate{
			Name:         cert.Subject.CommonName,
			Issuer:       cert.Issuer.CommonName,
			Subject:      cert.Subject.String(),
			SerialNumber: cert.SerialNumber.String(),
			ValidFrom:    cert.NotBefore.Format("2006-01-02"),
			ValidTo:      cert.NotAfter.Format("2006-01-02"),
			Fingerprint:  fingerprintHex,
			Source:       "NSS Database",
			KeyUsage:     keyUsages,
			IsValid:      isValid,
			NSSNickname:  nc.Nickname,
			CanSign:      canSign,
			RequiresPin:  false,
			PinOptional:  true,
		})
	}

	return certs, nil
}
