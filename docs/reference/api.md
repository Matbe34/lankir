# API Reference

This reference documents the Go backend services exposed to the frontend via Wails bindings.

## PDFService

PDF file operations and rendering.

### Methods

#### `OpenPDF() (*PDFMetadata, error)`

Opens a PDF file using a system file dialog.

**Returns:**
- `PDFMetadata`: Document information
- `error`: If dialog cancelled or file invalid

#### `OpenPDFByPath(path string) (*PDFMetadata, error)`

Opens a PDF file at the specified path.

**Parameters:**
- `path`: Absolute path to PDF file

**Returns:**
- `PDFMetadata`: Document information

#### `ClosePDF()`

Closes the currently open PDF and releases resources.

#### `GetPageCount() int`

Returns the number of pages in the open document.

#### `RenderPage(pageNum int, zoom float64) (string, error)`

Renders a page to a base64-encoded PNG image.

**Parameters:**
- `pageNum`: Page number (0-indexed)
- `zoom`: Zoom factor (1.0 = 100%)

**Returns:**
- `string`: Base64-encoded PNG data

#### `GetPageDimensions(pageNum int) (*PageDimensions, error)`

Gets the dimensions of a page in points.

**Parameters:**
- `pageNum`: Page number (0-indexed)

**Returns:**
- `PageDimensions`: Width and height in points

### Types

```go
type PDFMetadata struct {
    FilePath  string `json:"filePath"`
    Title     string `json:"title"`
    Author    string `json:"author"`
    Subject   string `json:"subject"`
    Creator   string `json:"creator"`
    PageCount int    `json:"pageCount"`
}

type PageDimensions struct {
    Width  float64 `json:"width"`
    Height float64 `json:"height"`
}
```

---

## SignatureService

Digital signature operations.

### Certificate Methods

#### `ListCertificates() ([]Certificate, error)`

Lists all available certificates from configured sources.

#### `ListCertificatesFiltered(filter CertificateFilter) ([]Certificate, error)`

Lists certificates matching filter criteria.

**Parameters:**
- `filter`: Filter options

#### `SearchCertificates(query string) ([]Certificate, error)`

Searches certificates by name, subject, issuer, or serial.

### Signing Methods

#### `SignPDF(pdfPath, certFingerprint, pin string) (string, error)`

Signs a PDF with the default signature profile.

**Parameters:**
- `pdfPath`: Path to PDF file
- `certFingerprint`: Certificate SHA-256 fingerprint
- `pin`: PIN or password

**Returns:**
- `string`: Path to signed PDF

#### `SignPDFWithProfile(pdfPath, certFingerprint, pin, profileID string) (string, error)`

Signs a PDF with a specific signature profile.

#### `SignPDFWithProfileAndPosition(pdfPath, certFingerprint, pin, profileID string, position *SignaturePosition) (string, error)`

Signs a PDF with custom position override.

### Verification Methods

#### `VerifySignatures(pdfPath string) ([]SignatureInfo, error)`

Verifies all signatures in a PDF.

**Returns:**
- `[]SignatureInfo`: List of signature details

### Profile Methods

#### `ListSignatureProfiles() ([]*SignatureProfile, error)`

Returns all saved signature profiles.

#### `GetSignatureProfile(profileID string) (*SignatureProfile, error)`

Gets a profile by UUID string.

#### `GetDefaultSignatureProfile() (*SignatureProfile, error)`

Returns the default profile.

#### `SaveSignatureProfile(profile *SignatureProfile) error`

Saves a new or updated profile.

#### `DeleteSignatureProfile(profileID string) error`

Deletes a profile by UUID.

### Configuration Methods

#### `AddCertificateStore(path string) error`

Adds a certificate directory path.

#### `RemoveCertificateStore(path string) error`

Removes a certificate directory.

#### `AddTokenLibrary(path string) error`

Adds a PKCS#11 module path.

#### `RemoveTokenLibrary(path string) error`

Removes a PKCS#11 module.

### Types

```go
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
    CanSign      bool     `json:"canSign"`
    RequiresPin  bool     `json:"requiresPin"`
    PinOptional  bool     `json:"pinOptional"`
    FilePath     string   `json:"filePath,omitempty"`
    PKCS11Module string   `json:"pkcs11Module,omitempty"`
}

type CertificateFilter struct {
    Source           string `json:"source"`
    Search           string `json:"search"`
    ValidOnly        bool   `json:"validOnly"`
    RequiredKeyUsage string `json:"requiredKeyUsage"`
}

type SignatureInfo struct {
    SignerName                   string `json:"signerName"`
    SignerDN                     string `json:"signerDN"`
    SigningTime                  string `json:"signingTime"`
    SignatureType                string `json:"signatureType"`
    IsValid                      bool   `json:"isValid"`
    CertificateValid             bool   `json:"certificateValid"`
    ValidationMessage            string `json:"validationMessage"`
    CertificateValidationMessage string `json:"certificateValidationMessage"`
    Reason                       string `json:"reason"`
    Location                     string `json:"location"`
}

type SignatureProfile struct {
    ID          string              `json:"id"`
    Name        string              `json:"name"`
    Description string              `json:"description"`
    Visibility  string              `json:"visibility"`
    Position    SignaturePosition   `json:"position"`
    Appearance  SignatureAppearance `json:"appearance"`
    IsDefault   bool                `json:"isDefault"`
}

type SignaturePosition struct {
    Page   int     `json:"page"`
    X      float64 `json:"x"`
    Y      float64 `json:"y"`
    Width  float64 `json:"width"`
    Height float64 `json:"height"`
}

type SignatureAppearance struct {
    ShowSignerName  bool   `json:"showSignerName"`
    ShowSigningTime bool   `json:"showSigningTime"`
    ShowLocation    bool   `json:"showLocation"`
    ShowLogo        bool   `json:"showLogo"`
    LogoPath        string `json:"logoPath"`
    LogoPosition    string `json:"logoPosition"`
    CustomText      string `json:"customText"`
    FontSize        int    `json:"fontSize"`
}
```

---

## ConfigService

Application configuration management.

### Methods

#### `Get() *Config`

Returns a copy of the current configuration.

#### `Update(config *Config) error`

Replaces configuration and saves to disk.

#### `Reset() error`

Resets all settings to defaults.

### Types

```go
type Config struct {
    Theme             string   `json:"theme"`
    AccentColor       string   `json:"accentColor"`
    DefaultZoom       int      `json:"defaultZoom"`
    ShowLeftSidebar   bool     `json:"showLeftSidebar"`
    ShowRightSidebar  bool     `json:"showRightSidebar"`
    DefaultViewMode   string   `json:"defaultViewMode"`
    RecentFilesLength int      `json:"recentFilesLength"`
    AutosaveInterval  int      `json:"autosaveInterval"`
    CertificateStores []string `json:"certificateStores"`
    TokenLibraries    []string `json:"tokenLibraries"`
    DebugMode         bool     `json:"debugMode"`
    HardwareAccel     bool     `json:"hardwareAccel"`
}
```

---

## RecentFilesService

Recent file history management.

### Methods

#### `GetRecentFiles() []RecentFile`

Returns list of recently opened files.

#### `AddRecentFile(path string) error`

Adds a file to recent history.

#### `ClearRecentFiles() error`

Clears all recent file history.

### Types

```go
type RecentFile struct {
    Path      string `json:"path"`
    Name      string `json:"name"`
    Timestamp string `json:"timestamp"`
}
```

---

## App

Application-level operations.

### Methods

#### `OpenFileDialog() (string, error)`

Shows system file open dialog.

**Returns:**
- `string`: Selected file path (empty if cancelled)

#### `SaveFileDialog(defaultFilename string) (string, error)`

Shows system file save dialog.

#### `ShowMessageDialog(title, message string)`

Shows a system message dialog.

---

## Frontend Usage Examples

### Opening a PDF

```javascript
import { PDFService } from '../wailsjs/go/pdf/PDFService.js';

async function openPDF() {
    try {
        const metadata = await PDFService.OpenPDF();
        console.log(`Opened: ${metadata.title} (${metadata.pageCount} pages)`);
    } catch (error) {
        console.error('Failed to open PDF:', error);
    }
}
```

### Listing Certificates

```javascript
import { SignatureService } from '../wailsjs/go/signature/SignatureService.js';

async function showCertificates() {
    const certs = await SignatureService.ListCertificates();
    
    for (const cert of certs) {
        console.log(`${cert.name} - ${cert.fingerprint}`);
        console.log(`  Valid: ${cert.isValid}, Can Sign: ${cert.canSign}`);
    }
}
```

### Signing a PDF

```javascript
async function signDocument(pdfPath, certFingerprint, pin) {
    try {
        const signedPath = await SignatureService.SignPDF(
            pdfPath, 
            certFingerprint, 
            pin
        );
        console.log(`Signed document: ${signedPath}`);
    } catch (error) {
        console.error('Signing failed:', error);
    }
}
```

### Updating Configuration

```javascript
import { Service as ConfigService } from '../wailsjs/go/config/Service.js';

async function setTheme(theme) {
    const config = await ConfigService.Get();
    config.theme = theme;
    await ConfigService.Update(config);
}
```
