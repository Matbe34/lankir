//go:build linux

package signature

import (
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/nss"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// signWithNSS signs a PDF using an NSS certificate (Linux only)
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

// signWithPlatformStore signs using platform-specific certificate store (NSS on Linux)
func (s *SignatureService) signWithPlatformStore(pdfPath string, cert *types.Certificate, password string, profile *SignatureProfile) (string, error) {
	// On Linux, platform store certificates come from NSS
	return s.signWithNSS(pdfPath, cert, password, profile)
}
