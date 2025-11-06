package signature

import (
	"crypto"
	"crypto/x509"
)

// CertificateSigner is an interface for signing with certificates
type CertificateSigner interface {
	crypto.Signer
	Certificate() *x509.Certificate
}
