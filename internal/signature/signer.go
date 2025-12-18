package signature

import (
	"crypto"
	"crypto/x509"
)

// CertificateSigner combines crypto.Signer with access to the signing certificate.
type CertificateSigner interface {
	crypto.Signer
	Certificate() *x509.Certificate
}
