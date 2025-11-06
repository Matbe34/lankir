package signature

import (
	"fmt"
	"os/exec"
	"strings"
)

func (s *SignatureService) VerifySignature(pdfPath string) ([]SignatureInfo, error) {
	if _, err := exec.LookPath("pdfsig"); err != nil {
		return nil, fmt.Errorf("pdfsig not found - install poppler-utils")
	}

	cmd := exec.Command("pdfsig", pdfPath)
	output, err := cmd.CombinedOutput()

	outputStr := string(output)
	if err != nil && !strings.Contains(outputStr, "does not contain any signatures") {
		return nil, fmt.Errorf("pdfsig verification failed: %w - %s", err, outputStr)
	}

	signatures := s.parseSignatureOutput(outputStr)
	return signatures, nil
}

func (s *SignatureService) parseSignatureOutput(output string) []SignatureInfo {
	var signatures []SignatureInfo

	lines := strings.Split(output, "\n")
	var currentSig *SignatureInfo

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "Signature #") {
			if currentSig != nil {
				signatures = append(signatures, *currentSig)
			}
			currentSig = &SignatureInfo{
				CertificateValid: true,
			}
		}

		if currentSig != nil {
			line = strings.TrimPrefix(line, "- ")

			if strings.HasPrefix(line, "Signer Certificate Common Name:") {
				currentSig.SignerName = strings.TrimPrefix(line, "Signer Certificate Common Name:")
				currentSig.SignerName = strings.TrimSpace(currentSig.SignerName)
			} else if strings.HasPrefix(line, "Signer full Distinguished Name:") {
				currentSig.SignerDN = strings.TrimPrefix(line, "Signer full Distinguished Name:")
				currentSig.SignerDN = strings.TrimSpace(currentSig.SignerDN)
				if currentSig.SignerName == "" {
					currentSig.SignerName = currentSig.SignerDN
				}
			} else if strings.HasPrefix(line, "Signing Date:") || strings.HasPrefix(line, "Signing Time:") {
				timeStr := strings.TrimPrefix(line, "Signing Date:")
				timeStr = strings.TrimPrefix(timeStr, "Signing Time:")
				currentSig.SigningTime = strings.TrimSpace(timeStr)
			} else if strings.HasPrefix(line, "Signing Hash Algorithm:") {
				currentSig.SigningHashAlgorithm = strings.TrimPrefix(line, "Signing Hash Algorithm:")
				currentSig.SigningHashAlgorithm = strings.TrimSpace(currentSig.SigningHashAlgorithm)
			} else if strings.HasPrefix(line, "Signature Type:") {
				currentSig.SignatureType = strings.TrimPrefix(line, "Signature Type:")
				currentSig.SignatureType = strings.TrimSpace(currentSig.SignatureType)
			} else if strings.HasPrefix(line, "Signature Validation:") {
				validationStatus := strings.TrimPrefix(line, "Signature Validation:")
				validationStatus = strings.TrimSpace(validationStatus)
				currentSig.ValidationMessage = validationStatus
				currentSig.IsValid = strings.Contains(strings.ToLower(validationStatus), "valid")
			} else if strings.HasPrefix(line, "Certificate Validation:") {
				certStatus := strings.TrimPrefix(line, "Certificate Validation:")
				certStatus = strings.TrimSpace(certStatus)
				currentSig.CertificateValidationMessage = certStatus
				currentSig.CertificateValid = !strings.Contains(strings.ToLower(certStatus), "unknown") &&
					!strings.Contains(strings.ToLower(certStatus), "issue") &&
					!strings.Contains(strings.ToLower(certStatus), "error") &&
					!strings.Contains(strings.ToLower(certStatus), "corrupt")
			} else if strings.Contains(line, "Signature is Valid") {
				currentSig.IsValid = true
			} else if strings.HasPrefix(line, "Reason:") {
				currentSig.Reason = strings.TrimPrefix(line, "Reason:")
				currentSig.Reason = strings.TrimSpace(currentSig.Reason)
			} else if strings.HasPrefix(line, "Location:") {
				currentSig.Location = strings.TrimPrefix(line, "Location:")
				currentSig.Location = strings.TrimSpace(currentSig.Location)
			} else if strings.HasPrefix(line, "Contact Info:") {
				currentSig.ContactInfo = strings.TrimPrefix(line, "Contact Info:")
				currentSig.ContactInfo = strings.TrimSpace(currentSig.ContactInfo)
			}
		}
	}

	if currentSig != nil {
		signatures = append(signatures, *currentSig)
	}

	return signatures
}
