package certutil

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"path/filepath"
	"time"

	"github.com/ferran/pdf_app/internal/signature/types"
)

func IsCertificateValidForSigning(cert *x509.Certificate) bool {
	if cert.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return false
	}

	if cert.IsCA {
		return false
	}

	return true
}

// ConvertX509Certificate converts an x509.Certificate to types.Certificate
func ConvertX509Certificate(cert *x509.Certificate, source string, filename string) types.Certificate {
	var keyUsage []string
	if cert.KeyUsage&x509.KeyUsageDigitalSignature != 0 {
		keyUsage = append(keyUsage, "Digital Signature")
	}
	if cert.KeyUsage&x509.KeyUsageContentCommitment != 0 {
		keyUsage = append(keyUsage, "Non Repudiation")
	}
	if cert.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
		keyUsage = append(keyUsage, "Key Encipherment")
	}

	name := cert.Subject.CommonName
	if name == "" && filename != "" {
		name = filepath.Base(filename)
	}
	if name == "" {
		name = "Unknown Certificate"
	}

	// Calculate SHA-256 fingerprint
	hash := sha256.Sum256(cert.Raw)
	fingerprint := hex.EncodeToString(hash[:])

	// Check if certificate is currently valid
	now := time.Now()
	isValid := now.After(cert.NotBefore) && now.Before(cert.NotAfter)

	// Check if certificate has digital signature capability
	canSign := cert.KeyUsage&x509.KeyUsageDigitalSignature != 0

	return types.Certificate{
		Name:         name,
		Issuer:       cert.Issuer.CommonName,
		Subject:      cert.Subject.CommonName,
		SerialNumber: cert.SerialNumber.String(),
		ValidFrom:    cert.NotBefore.Format("2006-01-02 15:04:05"),
		ValidTo:      cert.NotAfter.Format("2006-01-02 15:04:05"),
		Fingerprint:  fingerprint,
		Source:       source,
		KeyUsage:     keyUsage,
		IsValid:      isValid,
		CanSign:      canSign,
	}
}
