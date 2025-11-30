package signature

import (
	"crypto"
	"crypto/x509"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"github.com/ferran/pdf_app/internal/signature/nss"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
)

// SignPDF signs a PDF using the specified certificate and PIN
// Uses the default invisible signature profile for backward compatibility
func (s *SignatureService) SignPDF(pdfPath string, certFingerprint string, pin string) (string, error) {
	defaultProfile, err := s.profileManager.GetDefaultProfile()
	if err != nil {
		return "", fmt.Errorf("failed to get default profile: %w", err)
	}
	return s.SignPDFWithProfile(pdfPath, certFingerprint, pin, defaultProfile.ID)
}

// SignPDFWithProfile signs a PDF using the specified certificate, PIN, and signature profile
func (s *SignatureService) SignPDFWithProfile(pdfPath string, certFingerprint string, pin string, profileID string) (string, error) {
	return s.SignPDFWithProfileAndPosition(pdfPath, certFingerprint, pin, profileID, nil)
}

// SignPDFWithProfileAndPosition signs a PDF with optional position override for visible signatures
// If positionOverride is provided, it will be used instead of the profile's default position
func (s *SignatureService) SignPDFWithProfileAndPosition(pdfPath string, certFingerprint string, pin string, profileID string, positionOverride *SignaturePosition) (string, error) {
	// Get the signature profile
	profile, err := s.profileManager.GetProfile(profileID)
	if err != nil {
		return "", fmt.Errorf("failed to get signature profile: %w", err)
	}

	// Apply position override if provided (for user-selected positions)
	if positionOverride != nil && profile.Visibility == VisibilityVisible {
		// Ensure the override has valid dimensions
		if positionOverride.Width <= 0 {
			positionOverride.Width = 200
		}
		if positionOverride.Height <= 0 {
			positionOverride.Height = 80
		}
		if positionOverride.Page <= 0 {
			positionOverride.Page = 1
		}
		profile.Position = *positionOverride
	}

	// Validate the profile
	if err := s.profileManager.ValidateProfile(profile); err != nil {
		return "", fmt.Errorf("invalid signature profile: %w", err)
	}

	certs, err := s.ListCertificates()
	if err != nil {
		return "", fmt.Errorf("failed to list certificates: %w", err)
	}

	var selectedCert *Certificate
	for _, cert := range certs {
		if cert.Fingerprint == certFingerprint {
			selectedCert = &cert
			break
		}
	}

	if selectedCert == nil {
		return "", fmt.Errorf("certificate not found")
	}

	if !selectedCert.IsValid {
		return "", fmt.Errorf("certificate is not valid")
	}

	hasSigningCapability := false
	for _, usage := range selectedCert.KeyUsage {
		if strings.Contains(usage, "Digital Signature") || strings.Contains(usage, "Non Repudiation") {
			hasSigningCapability = true
			break
		}
	}

	if !hasSigningCapability {
		return "", fmt.Errorf("certificate does not have digital signature capability")
	}

	switch selectedCert.Source {
	case "pkcs11":
		return s.signWithPKCS11(pdfPath, selectedCert, pin, profile)
	case "User NSS DB":
		return s.signWithNSS(pdfPath, selectedCert, pin, profile)
	case "user", "system":
		if selectedCert.FilePath == "" {
			return "", fmt.Errorf("certificate does not have an associated file path")
		}

		ext := strings.ToLower(filepath.Ext(selectedCert.FilePath))
		if ext == ".p12" || ext == ".pfx" {
			return s.signWithPKCS12(pdfPath, selectedCert, pin, profile)
		}

		if strings.Contains(selectedCert.FilePath, ".pki/nssdb") {
			return s.signWithNSS(pdfPath, selectedCert, pin, profile)
		}

		return "", fmt.Errorf("cannot sign with certificate file '%s': certificate-only files do not contain private keys. To sign documents, use:\n• A smart card/USB token (PKCS#11)\n• A PKCS#12 file (.p12 or .pfx) that contains both certificate and private key", filepath.Base(selectedCert.FilePath))
	default:
		return "", fmt.Errorf("unsupported certificate source: %s", selectedCert.Source)
	}
}

func (s *SignatureService) signWithPKCS11(pdfPath string, cert *Certificate, pin string, profile *SignatureProfile) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	modulePath := cert.PKCS11Module

	if modulePath == "" && cert.Source == "NSS Database" {
		modulePath = "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so"
	}

	if modulePath == "" {
		return "", fmt.Errorf("certificate does not have PKCS11 module information")
	}

	signer, err := pkcs11.GetSignerFromCertificate(modulePath, cert.Fingerprint, pin)
	if err != nil {
		return "", fmt.Errorf("failed to access PKCS#11 certificate: %w", err)
	}
	defer signer.Close()

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signWithNSS(pdfPath string, cert *Certificate, password string, profile *SignatureProfile) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	nickname := cert.NSSNickname
	if nickname == "" {
		if cert.FilePath != "" {
			base := filepath.Base(cert.FilePath)
			nickname = strings.TrimSuffix(base, filepath.Ext(base))
		}
	}
	if nickname == "" {
		nickname = cert.Name
	}

	signer, err := nss.GetNSSSigner(nickname, password)
	if err != nil {
		if !strings.HasPrefix(nickname, "CERTIFICADO ") {
			parts := strings.Fields(nickname)
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1]
				nickname = "CERTIFICADO " + lastPart
				signer, err = nss.GetNSSSigner(nickname, password)
			}
		}
		if err != nil {
			return "", fmt.Errorf("failed to access NSS certificate: %w", err)
		}
	}
	defer signer.Close()

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signWithPKCS12(pdfPath string, cert *Certificate, password string, profile *SignatureProfile) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	if cert.FilePath == "" {
		return "", fmt.Errorf("certificate does not have file path information")
	}

	signer, err := pkcs12.GetSignerFromPKCS12File(cert.FilePath, password)
	if err != nil {
		return "", fmt.Errorf("failed to load PKCS#12 certificate: %w", err)
	}

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signPDFWithSigner(inputPath, outputPath string, signer CertificateSigner, cert *Certificate, profile *SignatureProfile) error {
	signingTime := time.Now().Local()

	// Create appearance based on profile
	appearance := CreateSignatureAppearance(profile, cert, signingTime)

	// Determine signature type based on visibility
	certType := sign.CertificationSignature
	if profile.Visibility == VisibilityVisible {
		certType = sign.ApprovalSignature
	}

	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			Info: sign.SignDataSignatureInfo{
				Name: cert.Name,
				Date: signingTime,
			},
			CertType:   certType,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
		},
		Appearance:        *appearance,
		Signer:            signer,
		DigestAlgorithm:   crypto.SHA256,
		Certificate:       signer.Certificate(),
		CertificateChains: [][]*x509.Certificate{{signer.Certificate()}},
		TSA: sign.TSA{
			URL:      "",
			Username: "",
			Password: "",
		},
	}

	err := sign.SignFile(inputPath, outputPath, signData)
	if err != nil {
		return fmt.Errorf("failed to sign PDF: %w", err)
	}

	return nil
}
