package signature

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/verify"
)

// VerifySignatures validates all digital signatures in a PDF and returns their status.
func (s *SignatureService) VerifySignatures(pdfPath string) ([]types.SignatureInfo, error) {
	file, err := os.Open(pdfPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open PDF: %w", err)
	}
	defer file.Close()

	response, err := verify.VerifyFile(file)
	if err != nil {
		errMsg := err.Error()

		if strings.Contains(errMsg, "no digital signature in document") {
			return []types.SignatureInfo{}, nil
		}
		return nil, fmt.Errorf("verification failed: %w", err)
	}

	if len(response.Signers) == 0 {
		return []types.SignatureInfo{}, nil
	}

	var signatures []types.SignatureInfo
	for _, signer := range response.Signers {
		sigInfo := s.convertSignerToInfo(signer, response.Error)
		signatures = append(signatures, sigInfo)
	}

	return signatures, nil
}

func (s *SignatureService) convertSignerToInfo(signer verify.Signer, responseError string) types.SignatureInfo {
	info := types.SignatureInfo{
		SignerName:       signer.Name,
		Reason:           signer.Reason,
		Location:         signer.Location,
		ContactInfo:      signer.ContactInfo,
		IsValid:          signer.ValidSignature,
		CertificateValid: signer.TrustedIssuer && !signer.RevokedCertificate,
	}

	if signer.SignatureTime != nil {
		info.SigningTime = signer.SignatureTime.Format(time.RFC3339)
	} else if signer.VerificationTime != nil {
		info.SigningTime = signer.VerificationTime.Format(time.RFC3339)
	}

	if len(signer.Certificates) > 0 {
		certWrapper := signer.Certificates[0]
		if certWrapper.Certificate != nil {
			cert := certWrapper.Certificate
			info.SignerDN = cert.Subject.String()
			if info.SignerName == "" {
				info.SignerName = cert.Subject.CommonName
				if info.SignerName == "" {
					info.SignerName = cert.Subject.String()
				}
			}
			info.SignatureType = cert.SignatureAlgorithm.String()
			info.SigningHashAlgorithm = cert.PublicKeyAlgorithm.String()

			if certWrapper.VerifyError != "" {
				if info.CertificateValidationMessage != "" {
					info.CertificateValidationMessage += "; " + certWrapper.VerifyError
				} else {
					info.CertificateValidationMessage = certWrapper.VerifyError
				}
			}
		}
	}

	if signer.ValidSignature {
		info.ValidationMessage = "Signature is cryptographically valid"
	} else {
		info.ValidationMessage = "Signature validation failed"
		if responseError != "" {
			info.ValidationMessage += ": " + responseError
		}
		if len(signer.TimeWarnings) > 0 {
			for _, warning := range signer.TimeWarnings {
				info.ValidationMessage += "; " + warning
			}
		}
	}

	if signer.RevokedCertificate {
		info.CertificateValidationMessage = "Certificate has been revoked"
		info.CertificateValid = false

		if len(signer.Certificates) > 0 {
			certWrapper := signer.Certificates[0]
			if certWrapper.RevocationTime != nil {
				info.CertificateValidationMessage += " on " + certWrapper.RevocationTime.Format("2006-01-02 15:04:05")
			}
			if certWrapper.RevokedBeforeSigning {
				info.CertificateValidationMessage += " (revoked before signing)"
			}
			if certWrapper.RevocationWarning != "" {
				info.CertificateValidationMessage += "; " + certWrapper.RevocationWarning
			}
		}
	} else if signer.TrustedIssuer {
		info.CertificateValidationMessage = "Certificate is valid and trusted"
	} else {
		info.CertificateValidationMessage = "Certificate chain validation issue (not in system trust store)"

		if len(signer.Certificates) > 0 {
			certWrapper := signer.Certificates[0]
			if certWrapper.KeyUsageError != "" {
				info.CertificateValidationMessage += "; Key usage: " + certWrapper.KeyUsageError
			}
			if certWrapper.ExtKeyUsageError != "" {
				info.CertificateValidationMessage += "; Extended key usage: " + certWrapper.ExtKeyUsageError
			}
		}
	}

	if signer.TimestampStatus != "" && signer.TimestampStatus != "missing" {
		if signer.TimestampStatus == "valid" && signer.TimestampTrusted {
			info.ValidationMessage += " with valid trusted timestamp"
		} else if signer.TimestampStatus == "valid" && !signer.TimestampTrusted {
			info.ValidationMessage += " with valid but untrusted timestamp"
		} else {
			info.ValidationMessage += " with invalid timestamp"
		}
	}

	return info
}
