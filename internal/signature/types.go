package signature

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
	CanSign      bool     `json:"canSign"` // Indicates if this certificate has an associated private key for signing
}

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
