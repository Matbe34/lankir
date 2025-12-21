# Backend Architecture

The Go backend provides all business logic, file operations, and system integrations.

## Service Pattern

All backend services follow a consistent pattern:

```go
type Service struct {
    ctx context.Context  // Wails context
    mu  sync.RWMutex     // Thread safety
    // ... service-specific fields
}

func NewService() *Service {
    return &Service{}
}

func (s *Service) Startup(ctx context.Context) {
    s.ctx = ctx
}
```

### Service Lifecycle

1. **Instantiation**: `NewService()` creates the service
2. **Binding**: Service added to Wails `Bind` array
3. **Startup**: Wails calls `Startup(ctx)` before first use
4. **Runtime**: Service methods called from frontend
5. **Shutdown**: Wails handles cleanup

## Core Services

### PDFService

Handles PDF file operations using MuPDF via go-fitz.

```go
// internal/pdf/service.go
type PDFService struct {
    ctx           context.Context
    mu            sync.RWMutex
    doc           *fitz.Document
    configService *config.Service
}
```

**Key Methods:**
- `OpenPDF()` / `OpenPDFByPath()` - Load PDF files
- `ClosePDF()` - Release resources
- `GetPageCount()` - Document info
- `RenderPage()` - Page to image
- `GetPageDimensions()` - Page size

**MuPDF Integration:**

PDF rendering uses CGO to call MuPDF's C library:

```go
// internal/pdf/render_annots.go
/*
#cgo CFLAGS: -I${SRCDIR}/../../go-fitz-include
#cgo linux,amd64 LDFLAGS: -L${SRCDIR}/../../go-fitz-libs -lmupdf_linux_amd64
#include <mupdf/fitz.h>
*/
import "C"
```

### ConfigService

Manages application settings with thread-safe access.

```go
// internal/config/config.go
type Service struct {
    mu         sync.RWMutex
    config     *Config
    configPath string
}
```

**Key Methods:**
- `Get()` - Read configuration (returns copy)
- `Update()` - Write configuration
- `Reset()` - Restore defaults
- `Load()` / `Save()` - Persistence

**Configuration Structure:**

```go
type Config struct {
    Theme             string   `json:"theme"`
    AccentColor       string   `json:"accentColor"`
    DefaultZoom       int      `json:"defaultZoom"`
    CertificateStores []string `json:"certificateStores"`
    TokenLibraries    []string `json:"tokenLibraries"`
    // ...
}
```

### SignatureService

Coordinates certificate management and PDF signing.

```go
// internal/signature/service.go
type SignatureService struct {
    ctx            context.Context
    profileManager *ProfileManager
    configService  *config.Service
}
```

**Key Methods:**
- `ListCertificates()` - Aggregate from all sources
- `SignPDF()` / `SignPDFWithProfile()` - Sign documents
- `VerifySignatures()` - Validate existing signatures
- Profile management methods

## Signature Subsystem

### Certificate Sources

```
SignatureService.ListCertificates()
         │
         ├── pkcs12.LoadCertificatesFromPath()
         │        → .p12/.pfx files
         │
         ├── pkcs11.LoadCertificatesFromModules()
         │        → Hardware tokens
         │
         └── nss.ListCertificates()
                  → Browser databases
```

### PKCS#11 Integration

Hardware token access via `miekg/pkcs11`:

```go
// internal/signature/pkcs11/signer.go
type Signer struct {
    cert       *x509.Certificate
    keyHandle  pkcs11.ObjectHandle
    session    pkcs11.SessionHandle
    p          *pkcs11.Ctx
}

func (ps *Signer) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    // Initialize signing operation
    ps.p.SignInit(ps.session, mechanism, ps.keyHandle)
    // Sign the digest
    return ps.p.Sign(ps.session, dataToSign)
}
```

### PKCS#12 Integration

Certificate file handling:

```go
// internal/signature/pkcs12/pkcs12.go
type Signer struct {
    cert       *x509.Certificate
    privateKey crypto.PrivateKey
}
```

### NSS Integration

Browser certificate access via CGO:

```go
// internal/signature/nss/nss.go
/*
#cgo pkg-config: nss
#include <nss.h>
#include <pk11pub.h>
*/
import "C"

type NSSSigner struct {
    cert       *x509.Certificate
    certNSS    *C.CERTCertificate
    privateKey *C.SECKEYPrivateKey
}
```

### Signing Flow

```go
func (s *SignatureService) SignPDFWithProfile(...) (string, error) {
    // 1. Parse profile ID
    profileID, _ := uuid.Parse(profileIDStr)
    
    // 2. Get profile settings
    profile, _ := s.profileManager.GetProfile(profileID)
    
    // 3. Find certificate
    selectedCert := findCertByFingerprint(certFingerprint)
    
    // 4. Route to appropriate signer
    switch selectedCert.Source {
    case "pkcs11":
        return s.signWithPKCS11(...)
    case "pkcs12":
        return s.signWithPKCS12(...)
    case "nss":
        return s.signWithNSS(...)
    }
}
```

## Profile Management

```go
// internal/signature/profile.go
type ProfileManager struct {
    configDir string
}

type SignatureProfile struct {
    ID          uuid.UUID
    Name        string
    Visibility  SignatureVisibility  // "invisible" or "visible"
    Position    SignaturePosition
    Appearance  SignatureAppearance
}
```

Profiles stored as JSON in `~/.config/lankir/signature_profiles/`.

## Thread Safety

All services use `sync.RWMutex` for concurrent access:

```go
func (s *Service) Get() *Config {
    s.mu.RLock()         // Read lock
    defer s.mu.RUnlock()
    
    configCopy := *s.config
    return &configCopy   // Return copy
}

func (s *Service) Update(config *Config) error {
    s.mu.Lock()          // Write lock
    defer s.mu.Unlock()
    
    s.config = config
    return s.saveUnlocked()
}
```

## Error Handling

Services return errors following Go conventions:

```go
func (s *Service) SomeMethod() (Result, error) {
    if err := validate(); err != nil {
        return Result{}, fmt.Errorf("validation failed: %w", err)
    }
    // ...
}
```

Frontend receives errors as rejected promises.

## Testing

Each package has `*_test.go` files:

```go
// internal/pdf/service_test.go
func TestOpenPDF(t *testing.T) {
    service := NewPDFService(nil)
    service.Startup(context.Background())
    
    _, err := service.OpenPDFByPath("testdata/sample.pdf")
    if err != nil {
        t.Fatalf("failed to open PDF: %v", err)
    }
}
```

Run tests:
```bash
task test
task test-coverage
```

## Build Requirements

### CGO Dependencies

MuPDF requires static libraries:

```bash
export CGO_CFLAGS="-I${PWD}/go-fitz-include"
export CGO_LDFLAGS="-L${PWD}/go-fitz-libs -lmupdf_linux_amd64 -lmupdfthird_linux_amd64"
```

### NSS Dependencies

```bash
# Debian/Ubuntu
sudo apt install libnss3-dev

# Build uses pkg-config
#cgo pkg-config: nss
```

## Next Steps

- [Frontend Architecture](frontend.md)
- [Signature System](signature-system.md)
- [Wails Integration](wails-integration.md)
