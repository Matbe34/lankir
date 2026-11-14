package types

import (
	"crypto/x509"
	"errors"
	"strings"
)

// ErrIncorrectPIN is returned when a token PIN or key password is wrong; the
// GUI matches its text to keep the sign panel open for a retry.
var ErrIncorrectPIN = errors.New("incorrect PIN or password")

// Certificate represents an X.509 certificate available for PDF signing.
type Certificate struct {
	Name         string   `json:"name"`
	Issuer       string   `json:"issuer"`
	Subject      string   `json:"subject"`
	SerialNumber string   `json:"serialNumber"`
	ValidFrom    string   `json:"validFrom"`
	ValidTo      string   `json:"validTo"`
	Fingerprint  string   `json:"fingerprint"`
	Source       string   `json:"source"`
	KeyUsage     []string `json:"keyUsage"`
	IsValid      bool     `json:"isValid"`
	NSSNickname  string   `json:"nssNickname,omitempty"`
	PKCS11URL    string   `json:"pkcs11Url,omitempty"`
	PKCS11Module string   `json:"pkcs11Module,omitempty"`
	FilePath     string   `json:"filePath,omitempty"`
	CanSign      bool     `json:"canSign"`
	RequiresPin  bool     `json:"requiresPin"`
	PinOptional  bool     `json:"pinOptional"`

	// X509Cert stores the raw x509.Certificate for internal use (not serialized)
	// This is used by platform-specific certificate stores (e.g., Windows Certificate Store)
	X509Cert *x509.Certificate `json:"-"`
}

// HasKeyUsage returns true if the certificate has the specified key usage.
func (c *Certificate) HasKeyUsage(usage string) bool {
	for _, u := range c.KeyUsage {
		if strings.EqualFold(u, usage) {
			return true
		}
	}
	return false
}

// HasSigningCapability returns true if the certificate can sign documents.
func (c *Certificate) HasSigningCapability() bool {
	if c.CanSign {
		return true
	}

	return c.HasKeyUsage("Digital Signature") || c.HasKeyUsage("Non Repudiation")
}

// ChainCertificate is one certificate of a signature's chain, by common name.
type ChainCertificate struct {
	Subject string `json:"subject"`
	Issuer  string `json:"issuer"`
}

// SignatureInfo contains validation details for a signature embedded in a PDF.
type SignatureInfo struct {
	SignerName  string `json:"signerName"`
	SignerDN    string `json:"signerDN"`
	SigningTime string `json:"signingTime"`
	// SigningTimeSource says where SigningTime comes from: "timestamp" (a
	// trusted timestamp), "signer" (the signer's computer, unverified) or ""
	// when the signature records no time.
	SigningTimeSource string `json:"signingTimeSource"`
	// SigningHashAlgorithm is the signature's digest algorithm. pdfsign does
	// not expose it, so it is empty rather than a guess.
	SigningHashAlgorithm string `json:"signingHashAlgorithm"`
	// SignatureType is the algorithm the issuer signed the signer's certificate with, e.g. "SHA256-RSA".
	SignatureType                string `json:"signatureType"`
	IsValid                      bool   `json:"isValid"`
	CertificateValid             bool   `json:"certificateValid"`
	ValidationMessage            string `json:"validationMessage"`
	CertificateValidationMessage string `json:"certificateValidationMessage"`
	Reason                       string `json:"reason"`
	Location                     string `json:"location"`
	ContactInfo                  string `json:"contactInfo"`

	// IssuerTrusted: the certificate chains to a root this system trusts,
	// whether or not the certificate was revoked.
	IssuerTrusted bool `json:"issuerTrusted"`
	// KeyAlgorithm is the signer's public key, e.g. "RSA 2048" or "ECDSA P-256".
	KeyAlgorithm          string `json:"keyAlgorithm"`
	IssuerName            string `json:"issuerName"`
	IssuerDN              string `json:"issuerDN"`
	CertificateSerial     string `json:"certificateSerial"`     // hex, colon-grouped
	CertificateValidFrom  string `json:"certificateValidFrom"`  // RFC 3339
	CertificateValidUntil string `json:"certificateValidUntil"` // RFC 3339
	TimestampTime         string `json:"timestampTime"`         // RFC 3339, empty without a timestamp
	// TimestampStatus is "valid", "untrusted", "invalid" or "none".
	TimestampStatus string `json:"timestampStatus"`
	// RevocationStatus is "good", "revoked", "revoked_later" (after a trusted
	// signing time), "unavailable" (asked online, no answer) or "not_checked";
	// RevocationCheck says how it was checked, or why not.
	RevocationStatus string             `json:"revocationStatus"`
	RevocationCheck  string             `json:"revocationCheck"`
	Chain            []ChainCertificate `json:"chain"` // signer first
	Warnings         []string           `json:"warnings"`
}
