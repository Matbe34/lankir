package certutil

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"path/filepath"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
)

// GetFingerprint calculates SHA-256 fingerprint of an x509 certificate
func GetFingerprint(cert *x509.Certificate) string {
	hash := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(hash[:])
}

// IsCertificateValidForSigning is the one rule for whether a certificate's key may sign documents:
// no keyUsage extension (unrestricted, RFC 5280 4.2.1.3), digitalSignature or nonRepudiation, and not a CA.
func IsCertificateValidForSigning(cert *x509.Certificate) bool {
	if cert.IsCA {
		return false
	}
	return cert.KeyUsage == 0 ||
		cert.KeyUsage&(x509.KeyUsageDigitalSignature|x509.KeyUsageContentCommitment) != 0
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
	fingerprint := GetFingerprint(cert)

	// Check if certificate is currently valid
	now := time.Now()
	isValid := now.After(cert.NotBefore) && now.Before(cert.NotAfter)

	canSign := IsCertificateValidForSigning(cert)

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
		X509Cert:     cert,
	}
}
