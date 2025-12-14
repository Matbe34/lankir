package types

import "strings"

// Certificate represents a digital certificate that can be used for PDF signing.
// It contains metadata about the certificate including its validity, key usage capabilities,
// and backend-specific information (PKCS#12 file path, PKCS#11 module, or NSS nickname).
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
}

// HasKeyUsage checks if the certificate has a specific key usage capability
// Uses exact string matching against the KeyUsage slice
func (c *Certificate) HasKeyUsage(usage string) bool {
	for _, u := range c.KeyUsage {
		if strings.EqualFold(u, usage) {
			return true
		}
	}
	return false
}

// HasSigningCapability checks if the certificate can be used for digital signatures
func (c *Certificate) HasSigningCapability() bool {
	if c.CanSign {
		return true
	}

	return c.HasKeyUsage("Digital Signature") || c.HasKeyUsage("Non Repudiation")
}

// SignatureInfo contains information about a signature embedded in a PDF document.
// It includes signer details, timestamps, validation status, and cryptographic algorithm information.
type SignatureInfo struct {
	SignerName                   string `json:"signerName"`
	SignerDN                     string `json:"signerDN"`
	SigningTime                  string `json:"signingTime"`
	SigningHashAlgorithm         string `json:"signingHashAlgorithm"`
	SignatureType                string `json:"signatureType"`
	IsValid                      bool   `json:"isValid"`
	CertificateValid             bool   `json:"certificateValid"`
	ValidationMessage            string `json:"validationMessage"`
	CertificateValidationMessage string `json:"certificateValidationMessage"`
	Reason                       string `json:"reason"`
	Location                     string `json:"location"`
	ContactInfo                  string `json:"contactInfo"`
}
