# Signature System Architecture

The signature system handles certificate discovery, PDF signing, and verification.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    SignatureService                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Certificate Aggregation                 │   │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐              │   │
│  │   │ PKCS#12 │ │ PKCS#11 │ │   NSS   │              │   │
│  │   │ Loader  │ │ Loader  │ │ Loader  │              │   │
│  │   └────┬────┘ └────┬────┘ └────┬────┘              │   │
│  │        │           │           │                    │   │
│  │        └───────────┼───────────┘                    │   │
│  │                    ▼                                 │   │
│  │         []types.Certificate                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Signing                            │   │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐              │   │
│  │   │ PKCS#12 │ │ PKCS#11 │ │   NSS   │              │   │
│  │   │ Signer  │ │ Signer  │ │ Signer  │              │   │
│  │   └────┬────┘ └────┬────┘ └────┬────┘              │   │
│  │        │           │           │                    │   │
│  │        └───────────┼───────────┘                    │   │
│  │                    ▼                                 │   │
│  │            digitorus/pdfsign                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Profile Management                      │   │
│  │        SignatureProfile → Appearance                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Certificate Types

### Certificate Structure

```go
// internal/signature/types/types.go
type Certificate struct {
    Name         string   `json:"name"`
    Issuer       string   `json:"issuer"`
    Subject      string   `json:"subject"`
    SerialNumber string   `json:"serialNumber"`
    ValidFrom    string   `json:"validFrom"`
    ValidTo      string   `json:"validTo"`
    Fingerprint  string   `json:"fingerprint"`    // SHA-256, unique ID
    Source       string   `json:"source"`         // pkcs12, pkcs11, nss
    KeyUsage     []string `json:"keyUsage"`
    IsValid      bool     `json:"isValid"`        // Within validity period
    CanSign      bool     `json:"canSign"`        // Has signing capability
    RequiresPin  bool     `json:"requiresPin"`
    FilePath     string   `json:"filePath,omitempty"`
    PKCS11Module string   `json:"pkcs11Module,omitempty"`
}
```

### Fingerprint Generation

```go
// internal/signature/certutil/convert.go
hash := sha256.Sum256(cert.Raw)
fingerprint := hex.EncodeToString(hash[:])
```

The SHA-256 fingerprint uniquely identifies certificates across all sources.

## Certificate Sources

### PKCS#12 (.p12, .pfx files)

Self-contained certificate + private key files:

```go
// internal/signature/pkcs12/pkcs12.go
func LoadCertificatesFromPath(dir string) ([]types.Certificate, error) {
    // Walk directory for .p12/.pfx files
    // Parse each file (without password - just read cert info)
    // Return certificate metadata
}

func LoadSignerFromFile(path, password string) (*Signer, error) {
    // Read file
    // Decrypt with password
    // Return signer with private key access
}
```

### PKCS#11 (Hardware Tokens)

Smart cards, USB tokens, HSMs via PKCS#11 API:

```go
// internal/signature/pkcs11/loader.go
func LoadCertificatesFromModules(modulePaths []string) ([]types.Certificate, error) {
    for _, modulePath := range modulePaths {
        // Validate module (security check)
        validatePKCS11Module(modulePath)
        
        // Load module
        p := pkcs11.New(modulePath)
        p.Initialize()
        
        // Enumerate slots and certificates
        slots, _ := p.GetSlotList(true)
        for _, slot := range slots {
            // Find certificate objects
            // Extract certificate data
        }
    }
}
```

**Module Validation:**

```go
func validatePKCS11Module(modulePath string) error {
    // Check file exists and is regular file
    // Verify reasonable file size (1KB - 200MB)
    // Check file is readable
}
```

### NSS (Browser Databases)

Firefox/Chrome certificate stores via CGO:

```go
// internal/signature/nss/nss.go
/*
#cgo pkg-config: nss
#include <nss.h>
#include <pk11pub.h>
#include <cert.h>
*/
import "C"

func ListCertificates() ([]Certificate, error) {
    // Initialize NSS with user's database
    C.nss_init(nssDBPath)
    
    // Get all certificates
    certList := C.get_all_certs()
    
    // Filter for those with private keys
    // Convert to Go structures
}
```

## Signer Interface

All signing backends implement `crypto.Signer`:

```go
// internal/signature/signer.go
type CertificateSigner interface {
    crypto.Signer
    Certificate() *x509.Certificate
}
```

This allows pdfsign to use any backend uniformly.

### PKCS#12 Signer

```go
type Signer struct {
    cert       *x509.Certificate
    privateKey crypto.PrivateKey
}

func (ps *Signer) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    if signer, ok := ps.privateKey.(crypto.Signer); ok {
        return signer.Sign(rand, digest, opts)
    }
    return nil, fmt.Errorf("private key does not implement crypto.Signer")
}
```

### PKCS#11 Signer

```go
type Signer struct {
    cert       *x509.Certificate
    keyHandle  pkcs11.ObjectHandle
    session    pkcs11.SessionHandle
    p          *pkcs11.Ctx
}

func (ps *Signer) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    // Prepare DigestInfo for RSA PKCS#1
    dataToSign := createDigestInfo(digest)
    
    // Initialize signing on token
    ps.p.SignInit(ps.session, mechanism, ps.keyHandle)
    
    // Sign (happens on hardware)
    return ps.p.Sign(ps.session, dataToSign)
}
```

### NSS Signer

```go
type NSSSigner struct {
    cert       *x509.Certificate
    certNSS    *C.CERTCertificate
    privateKey *C.SECKEYPrivateKey
}

func (n *NSSSigner) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    // Call NSS signing function via CGO
    rv := C.sign_digest(n.privateKey, digestPtr, digestLen, sigPtr, &sigLen)
    // ...
}
```

## Signing Process

### Flow

```go
func (s *SignatureService) SignPDFWithProfile(
    pdfPath, certFingerprint, pin, profileIDStr string,
) (string, error) {
    
    // 1. Load profile
    profile, _ := s.profileManager.GetProfile(profileID)
    
    // 2. Find certificate
    certs, _ := s.ListCertificates()
    cert := findByFingerprint(certs, certFingerprint)
    
    // 3. Validate certificate
    if !cert.IsValid { return error }
    if !cert.HasSigningCapability() { return error }
    
    // 4. Route to appropriate signer
    switch cert.Source {
    case "pkcs11":
        return s.signWithPKCS11(pdfPath, cert, pin, profile)
    case "pkcs12":
        return s.signWithPKCS12(pdfPath, cert, pin, profile)
    case "nss":
        return s.signWithNSS(pdfPath, cert, pin, profile)
    }
}
```

### PDF Signing with pdfsign

```go
func (s *SignatureService) signPDFWithSigner(
    pdfPath, outputPath string,
    signer CertificateSigner,
    cert *types.Certificate,
    profile *SignatureProfile,
) error {
    // Open input PDF
    input, _ := os.Open(pdfPath)
    output, _ := os.Create(outputPath)
    
    // Create signature appearance
    appearance := CreateSignatureAppearance(profile, cert, time.Now())
    
    // Sign with pdfsign
    return sign.Sign(input, output, signer, sign.SignData{
        Signature: sign.SignDataSignature{
            Info: sign.SignDataSignatureInfo{
                Name:   cert.Name,
                Date:   time.Now(),
            },
        },
        Appearance: appearance,
    })
}
```

## Signature Appearance

### Profile Structure

```go
type SignatureProfile struct {
    ID          uuid.UUID
    Name        string
    Visibility  SignatureVisibility  // "invisible" or "visible"
    Position    SignaturePosition
    Appearance  SignatureAppearance
    IsDefault   bool
}

type SignaturePosition struct {
    Page   int
    X      float64  // Points from left
    Y      float64  // Points from bottom
    Width  float64
    Height float64
}

type SignatureAppearance struct {
    ShowSignerName  bool
    ShowSigningTime bool
    ShowLocation    bool
    ShowLogo        bool
    LogoPath        string  // Base64 data URL
    CustomText      string
    FontSize        int
}
```

### Appearance Generation

```go
// internal/signature/appearance.go
func CreateSignatureAppearance(
    profile *SignatureProfile,
    cert *types.Certificate,
    signingTime time.Time,
) *sign.Appearance {
    
    if profile.Visibility == VisibilityInvisible {
        return &sign.Appearance{Visible: false}
    }
    
    // Build text lines
    var textLines []string
    if profile.Appearance.ShowSignerName {
        textLines = append(textLines, "Signed by: "+cert.Name)
    }
    if profile.Appearance.ShowSigningTime {
        textLines = append(textLines, "Date: "+signingTime.Format(...))
    }
    
    // Generate image
    image := generateSignatureImage(textLines, profile)
    
    return &sign.Appearance{
        Visible:     true,
        Page:        profile.Position.Page,
        LowerLeftX:  profile.Position.X,
        LowerLeftY:  profile.Position.Y,
        UpperRightX: profile.Position.X + profile.Position.Width,
        UpperRightY: profile.Position.Y + profile.Position.Height,
        Image:       image,
    }
}
```

## Verification

```go
// internal/signature/verification.go
func (s *SignatureService) VerifySignatures(pdfPath string) ([]types.SignatureInfo, error) {
    file, _ := os.Open(pdfPath)
    
    // Use pdfsign's verify
    response, err := verify.VerifyFile(file)
    
    // Convert to our types
    var signatures []types.SignatureInfo
    for _, signer := range response.Signers {
        sigInfo := types.SignatureInfo{
            SignerName:       signer.Name,
            IsValid:          signer.ValidSignature,
            CertificateValid: signer.TrustedIssuer,
            // ...
        }
        signatures = append(signatures, sigInfo)
    }
    
    return signatures, nil
}
```

## Security Considerations

### PIN Handling

- PINs stored only in memory during operation
- Cleared after signing completes
- Never logged or persisted

### Path Validation

```go
func validateCertificateStorePath(path string) error {
    // Must be absolute
    if !filepath.IsAbs(path) { return error }
    
    // Resolve symlinks
    resolved, _ := filepath.EvalSymlinks(path)
    
    // Must be in allowed directories
    allowedPrefixes := []string{
        "/etc/ssl/certs",
        homeDir,
        // ...
    }
    
    // Validate against allowed list
}
```

### PKCS#11 Module Validation

```go
func validatePKCS11Module(modulePath string) error {
    // File must exist
    // Must be regular file (not symlink, device, etc.)
    // Must be readable
    // Size within reasonable bounds (1KB - 200MB)
}
```

## Next Steps

- [Wails Integration](wails-integration.md)
- [Development Setup](../development/setup.md)
- [User Guide: Signing](../user-guide/signing.md)
