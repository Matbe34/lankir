package certutil

import (
	"crypto/x509"
	"testing"
)

func TestIsCertificateValidForSigning(t *testing.T) {
	cases := []struct {
		name string
		cert x509.Certificate
		want bool
	}{
		{"digital signature", x509.Certificate{KeyUsage: x509.KeyUsageDigitalSignature}, true},
		// Qualified signature certificates on eID cards often carry only nonRepudiation.
		{"non-repudiation only", x509.Certificate{KeyUsage: x509.KeyUsageContentCommitment}, true},
		// RFC 5280: no keyUsage extension means no restriction.
		{"no key usage", x509.Certificate{}, true},
		{"encipherment only", x509.Certificate{KeyUsage: x509.KeyUsageKeyEncipherment}, false},
		{"CA", x509.Certificate{KeyUsage: x509.KeyUsageDigitalSignature, IsCA: true}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsCertificateValidForSigning(&c.cert); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}
