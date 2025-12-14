package signature

import (
	"crypto"
	"crypto/x509"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"github.com/ferran/pdf_app/internal/signature/nss"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
	"github.com/ferran/pdf_app/internal/signature/types"
	"github.com/google/uuid"
)

// generateSignedPDFPath generates the output path for a signed PDF
// Handles case-insensitive file extensions properly
func generateSignedPDFPath(pdfPath string) string {
	ext := filepath.Ext(pdfPath)
	base := strings.TrimSuffix(pdfPath, ext)
	return base + "_signed.pdf"
}

// SignPDF signs a PDF using the specified certificate and PIN
// Uses the default invisible signature profile for backward compatibility
func (s *SignatureService) SignPDF(pdfPath string, certFingerprint string, pin string) (string, error) {
	defaultProfile, err := s.profileManager.GetDefaultProfile()
	if err != nil {
		return "", fmt.Errorf("failed to get default profile: %w", err)
	}
	return s.SignPDFWithProfile(pdfPath, certFingerprint, pin, defaultProfile.ID.String())
}

// SignPDFWithProfile signs a PDF using the specified certificate, PIN, and signature profile
func (s *SignatureService) SignPDFWithProfile(pdfPath string, certFingerprint string, pin string, profileIDStr string) (string, error) {
	return s.SignPDFWithProfileAndPosition(pdfPath, certFingerprint, pin, profileIDStr, nil)
}

// SignPDFWithProfileAndPosition signs a PDF with optional position override for visible signatures
// If positionOverride is provided, it will be used instead of the profile's default position
func (s *SignatureService) SignPDFWithProfileAndPosition(pdfPath string, certFingerprint string, pin string, profileIDStr string, positionOverride *SignaturePosition) (string, error) {
	profileID, err := uuid.Parse(profileIDStr)
	if err != nil {
		return "", fmt.Errorf("invalid profile ID format: %w", err)
	}

	// Get the signature profile
	profile, err := s.profileManager.GetProfile(profileID)
	if err != nil {
		return "", fmt.Errorf("failed to get signature profile: %w", err)
	}

	// Apply position override if provided (for user-selected positions)
	if positionOverride != nil && profile.Visibility == VisibilityVisible {
		// Ensure the override has valid dimensions
		if positionOverride.Width <= 0 {
			positionOverride.Width = DefaultSignatureWidth
		}
		if positionOverride.Height <= 0 {
			positionOverride.Height = DefaultSignatureHeight
		}
		if positionOverride.Page <= 0 {
			positionOverride.Page = 1
		}

		const maxSignatureDimension = 2000.0
		if positionOverride.Width > maxSignatureDimension {
			return "", fmt.Errorf("signature width too large: %.2f points (maximum %.2f)",
				positionOverride.Width, maxSignatureDimension)
		}
		if positionOverride.Height > maxSignatureDimension {
			return "", fmt.Errorf("signature height too large: %.2f points (maximum %.2f)",
				positionOverride.Height, maxSignatureDimension)
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

	var selectedCert *types.Certificate
	for _, cert := range certs {
		if cert.Fingerprint == certFingerprint {
			selectedCert = &cert
			break
		}
	}

	if selectedCert == nil {
		return "", fmt.Errorf("certificate with fingerprint %s not found", certFingerprint)
	}

	if !selectedCert.IsValid {
		return "", fmt.Errorf("certificate '%s' is not valid (expired or not yet valid)", selectedCert.Name)
	}

	if !selectedCert.HasSigningCapability() {
		return "", fmt.Errorf("certificate '%s' does not have digital signature capability", selectedCert.Name)
	}

	switch selectedCert.Source {
	case "pkcs11":
		return s.signWithPKCS11(pdfPath, selectedCert, pin, profile)
	case "User NSS DB", "NSS Database":
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

		return "", fmt.Errorf("cannot sign with certificate file '%s': missing private key (use PKCS#11 token or PKCS#12 file)", filepath.Base(selectedCert.FilePath))
	default:
		return "", fmt.Errorf("unsupported certificate source: %s", selectedCert.Source)
	}
}

// getDefaultPKCS11ModulePath returns the default PKCS#11 module path for the current platform
func getDefaultPKCS11ModulePath() string {
	var candidates []string

	switch runtime.GOOS {
	case "linux":
		candidates = []string{
			"/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
			"/usr/lib/pkcs11/p11-kit-client.so",
			"/usr/lib64/pkcs11/p11-kit-client.so",
			"/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so",
		}
	case "darwin":
		candidates = []string{
			"/usr/local/lib/p11-kit-client.dylib",
			"/opt/homebrew/lib/p11-kit-client.dylib",
		}
	case "windows":
		candidates = []string{
			"p11-kit-client.dll",
		}
	}

	// Return the first existing module
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	return ""
}

func (s *SignatureService) signWithPKCS11(pdfPath string, cert *types.Certificate, pin string, profile *SignatureProfile) (string, error) {
	outputPath := generateSignedPDFPath(pdfPath)

	modulePath := cert.PKCS11Module

	if modulePath == "" && cert.Source == "NSS Database" {
		modulePath = getDefaultPKCS11ModulePath()
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

func (s *SignatureService) signWithNSS(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	outputPath := generateSignedPDFPath(pdfPath)

	if cert.NSSNickname == "" {
		return "", fmt.Errorf("NSS certificate is missing nickname field")
	}

	signer, err := nss.GetNSSSigner(cert.NSSNickname, password)
	if err != nil {
		return "", fmt.Errorf("failed to access NSS certificate with nickname '%s': %w", cert.NSSNickname, err)
	}
	defer signer.Close()

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signWithPKCS12(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	outputPath := generateSignedPDFPath(pdfPath)

	if cert.FilePath == "" {
		return "", fmt.Errorf("certificate does not have file path information")
	}

	var signer *pkcs12.Signer
	var err error

	// If PIN is optional and no password provided, try empty password first
	if cert.PinOptional && password == "" {
		signer, err = pkcs12.GetSignerFromPKCS12File(cert.FilePath, "")
		if err == nil {
			if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
				return "", fmt.Errorf("failed to sign PDF: %w", err)
			}
			return outputPath, nil
		}
		// Empty password didn't work, but certificate is marked as optional
		// This means it actually requires a password despite being marked optional
		return "", fmt.Errorf("PKCS#12 file requires a password")
	}

	// Password was provided, or PIN is required
	signer, err = pkcs12.GetSignerFromPKCS12File(cert.FilePath, password)
	if err != nil {
		return "", fmt.Errorf("failed to load PKCS#12 certificate: %w", err)
	}

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert, profile); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signPDFWithSigner(inputPath, outputPath string, signer CertificateSigner, cert *types.Certificate, profile *SignatureProfile) error {
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
		if _, statErr := os.Stat(outputPath); statErr == nil {
			os.Remove(outputPath)
		}
		return fmt.Errorf("failed to sign PDF: %w", err)
	}

	if _, err := os.Stat(outputPath); err != nil {
		return fmt.Errorf("signing completed but output file not found: %w", err)
	}

	return nil
}
