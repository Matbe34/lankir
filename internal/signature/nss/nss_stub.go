//go:build !linux

package nss

import (
	"crypto/x509"
	"fmt"
)

// Certificate represents a certificate from NSS (stub for non-Linux platforms)
type Certificate struct {
	Nickname      string
	X509Cert      *x509.Certificate
	HasPrivateKey bool
}

// NSSSigner is a stub for non-Linux platforms
type NSSSigner struct {
	cert *x509.Certificate
}

func (n *NSSSigner) Certificate() *x509.Certificate {
	return n.cert
}

func (n *NSSSigner) Close() {
	// No-op on non-Linux platforms
}

// ListCertificates is a stub that returns an error on non-Linux platforms
func ListCertificates() ([]Certificate, error) {
	return nil, fmt.Errorf("NSS certificate support is only available on Linux")
}

// GetNSSSigner is a stub that returns an error on non-Linux platforms
func GetNSSSigner(nickname, pin string) (*NSSSigner, error) {
	return nil, fmt.Errorf("NSS certificate support is only available on Linux")
}
