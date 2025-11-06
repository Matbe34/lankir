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

func (s *SignatureService) SignPDF(pdfPath string, certFingerprint string, pin string) (string, error) {
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
		return s.signWithPKCS11(pdfPath, selectedCert, pin)
	case "NSS Database":
		return s.signWithNSS(pdfPath, selectedCert, pin)
	case "user", "system":
		// Check if this is a PKCS#12 file with private key
		if selectedCert.FilePath == "" {
			return "", fmt.Errorf("certificate does not have an associated file path")
		}

		// Check file extension to determine if it's PKCS#12
		ext := strings.ToLower(filepath.Ext(selectedCert.FilePath))
		if ext == ".p12" || ext == ".pfx" {
			return s.signWithPKCS12(pdfPath, selectedCert, pin)
		}

		// If in NSS database directory, use NSS signing
		if strings.Contains(selectedCert.FilePath, ".pki/nssdb") {
			return s.signWithNSS(pdfPath, selectedCert, pin)
		}

		// Certificate files (.pem, .crt, .cer) don't contain private keys
		return "", fmt.Errorf("cannot sign with certificate file '%s': certificate-only files do not contain private keys. To sign documents, use:\n• A smart card/USB token (PKCS#11)\n• A PKCS#12 file (.p12 or .pfx) that contains both certificate and private key", filepath.Base(selectedCert.FilePath))
	default:
		return "", fmt.Errorf("unsupported certificate source: %s", selectedCert.Source)
	}
}

func (s *SignatureService) signWithPKCS11(pdfPath string, cert *Certificate, pin string) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	modulePath := cert.PKCS11Module

	// If module path is not set, check if this is NSS certificate
	if modulePath == "" && cert.Source == "NSS Database" {
		modulePath = "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so"
	}

	if modulePath == "" {
		return "", fmt.Errorf("certificate does not have PKCS11 module information")
	}

	// Get the PKCS#11 signer
	signer, err := pkcs11.GetSignerFromCertificate(modulePath, cert.Fingerprint, pin)
	if err != nil {
		return "", fmt.Errorf("failed to access PKCS#11 certificate: %w", err)
	}
	defer signer.Close()

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signWithNSS(pdfPath string, cert *Certificate, password string) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	// Use stored NSS nickname if available
	nickname := cert.NSSNickname
	if nickname == "" {
		// Fallback: try filename without extension
		if cert.FilePath != "" {
			base := filepath.Base(cert.FilePath)
			nickname = strings.TrimSuffix(base, filepath.Ext(base))
		}
	}
	if nickname == "" {
		nickname = cert.Name
	}

	fmt.Printf("Using NSS nickname: '%s'\n", nickname)

	signer, err := nss.GetNSSSigner(nickname, password)
	if err != nil {
		// Try with "CERTIFICADO " prefix (common pattern)
		if !strings.HasPrefix(nickname, "CERTIFICADO ") {
			// Extract just the ID part
			parts := strings.Fields(nickname)
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1]
				nickname = "CERTIFICADO " + lastPart
				fmt.Printf("Retrying with nickname: '%s'\n", nickname)
				signer, err = nss.GetNSSSigner(nickname, password)
			}
		}
		if err != nil {
			return "", fmt.Errorf("failed to access NSS certificate: %w", err)
		}
	}
	defer signer.Close()

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

func (s *SignatureService) signWithPKCS12(pdfPath string, cert *Certificate, password string) (string, error) {
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	if cert.FilePath == "" {
		return "", fmt.Errorf("certificate does not have file path information")
	}

	// Get the PKCS#12 signer
	signer, err := pkcs12.GetSignerFromPKCS12File(cert.FilePath, password)
	if err != nil {
		return "", fmt.Errorf("failed to load PKCS#12 certificate: %w", err)
	}

	if err := s.signPDFWithSigner(pdfPath, outputPath, signer, cert); err != nil {
		return "", fmt.Errorf("failed to sign PDF: %w", err)
	}

	return outputPath, nil
}

// signPDFWithSigner signs a PDF using the provided signer
func (s *SignatureService) signPDFWithSigner(inputPath, outputPath string, signer CertificateSigner, cert *Certificate) error {
	// Create signature data
	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			Info: sign.SignDataSignatureInfo{
				Name:        cert.Name,
				Location:    "Digital Signature",
				Reason:      "Document digitally signed",
				ContactInfo: "",
				Date:        time.Now().Local(),
			},
			CertType:   sign.CertificationSignature,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
		},
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

	// Sign the PDF using the library
	err := sign.SignFile(inputPath, outputPath, signData)
	if err != nil {
		return fmt.Errorf("failed to sign PDF: %w", err)
	}

	fmt.Printf("✓ PDF signed successfully!\n")
	return nil
}
