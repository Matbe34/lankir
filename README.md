# PDF Editor Pro

A modern, high-performance PDF editor for Linux built with Go and Wails.

## 🚀 Features

### Current
- ✅ **Desktop application** with Wails GUI
- ✅ **Powerful CLI tool** built with Cobra and slog
  - Single binary for both GUI and CLI
  - Structured logging with JSON support
  - Full PDF operations via command line
- ✅ **PDF Operations**
  - View PDF metadata
  - Render pages to PNG with custom DPI
  - Generate thumbnails
  - Get page dimensions
- ✅ **Digital Signatures**
  - Sign PDFs with X.509 certificates
  - Support for PKCS#11 hardware tokens (smart cards, USB tokens)
  - Support for PKCS#12 files (.p12, .pfx)
  - Support for NSS databases (Firefox/Thunderbird)
  - Signature verification with certificate chain validation
  - Visible and invisible signatures
  - Customizable signature profiles
  - Position control for visible signatures
- ✅ **Certificate Management**
  - List certificates from all sources
  - Search and filter certificates
  - Detailed certificate information
  - Validate certificate status and key usage

### Planned
- **PDF Viewing & Editing**
  - Enhanced PDF viewer in GUI
  - Page navigation and zoom controls
  - Text selection and search
  - Annotations and comments

- **Advanced Features**
  - Timestamp support for signatures (TSA)
  - PDF creation and conversion
  - Form filling
  - Page manipulation (merge, split, rotate)
  - Encryption and permissions management
  - Watermark signatures

## 🏗️ Architecture

```
pdf_app/
├── main.go                 # Application entry point
├── app.go                  # Main app structure
├── internal/
│   ├── pdf/               # PDF processing services
│   │   └── service.go     # PDF operations (open, render, edit)
│   └── signature/         # Digital signature services
│       └── service.go     # Certificate & signing operations
└── frontend/
    └── src/               # Web-based UI (HTML/CSS/JS)
        ├── index.html
        ├── style.css
        └── app.js
```

## 🛠️ Tech Stack

- **Backend**: Go (Golang)
  - High performance and efficient memory usage
  - Excellent concurrency for large PDFs
  - Strong ecosystem for cryptography
  
- **Desktop Framework**: Wails v2
  - Native performance with web-based UI
  - Cross-platform (Linux focus)
  - Modern development experience

- **Planned Libraries**:
  - PDF processing: `unidoc/unipdf` or `pdfcpu`
  - Digital signatures: Go crypto packages + PKCS#11
  - UI: Vanilla JS or React (TBD)

## 📋 Prerequisites

- Go 1.21 or higher
- Wails CLI v2
- Linux development headers:
  ```bash
  # Ubuntu/Debian
  sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev
  
  # Fedora
  sudo dnf install gtk3-devel webkit2gtk3-devel
  
  # Arch
  sudo pacman -S gtk3 webkit2gtk
  ```

## 🚀 Getting Started

### Installation

1. **Install Wails CLI** (for GUI development):
   ```bash
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```

2. **Install dependencies**:
   ```bash
   cd /home/ferran/pdf_app
   go mod tidy
   ```

3. **Build the application**:
   ```bash
   wails build
   # The binary will be in ./build/bin/

   # Or build CLI-only binary (faster, no GUI dependencies)
   go build -o pdf-app .
   ```

4. **Install to system** (optional):
   ```bash
   sudo cp build/bin/pdf_app /usr/local/bin/pdf-app
   # Or for CLI-only build:
   # sudo cp pdf-app /usr/local/bin/
   ```

### Development

Run GUI in development mode with hot reload:
```bash
wails dev
```

Test CLI commands during development:
```bash
go run . --help
go run . pdf info document.pdf
```

### Building for Production

```bash
# Build optimized binary
wails build -clean

# Build CLI-only (lightweight, no Wails dependencies)
go build -ldflags="-s -w" -o pdf-app .
```

## 📦 Project Status

This is the initial project setup. The following components are in place:

✅ Project structure  
✅ Go module initialized  
✅ Wails configuration  
✅ Basic UI layout  
✅ PDF service skeleton  
✅ Signature service skeleton  

### Next Steps

1. Install Wails and dependencies
2. Integrate PDF library (unipdf or pdfcpu)
3. Implement PDF viewing functionality
4. Add certificate management
5. Implement digital signature support

## 💻 Command Line Interface (CLI)

PDF Editor Pro includes a powerful CLI built with Cobra and slog. The same binary works as both GUI and CLI:

- **Run without arguments**: Launches the GUI
- **Run with arguments**: Executes CLI commands

### CLI Usage

```bash
# Launch GUI (default when no arguments)
./pdf-app
# Or explicitly
./pdf-app gui

# Show help
./pdf-app --help

# Enable verbose logging
./pdf-app --verbose <command>

# JSON output (for scripting)
./pdf-app --json <command>
```

### PDF Operations

```bash
# Display PDF metadata
pdf-app pdf info document.pdf
pdf-app pdf info document.pdf --json

# Show page dimensions
pdf-app pdf pages document.pdf

# Render a page to PNG
pdf-app pdf render document.pdf --page 1 --dpi 300 --output page1.png

# Generate thumbnail
pdf-app pdf thumbnail document.pdf --width 400 --output thumb.png
```

### Certificate Management

```bash
# List all certificates
pdf-app cert list

# List only valid certificates
pdf-app cert list --valid-only

# Filter by source (system, user, pkcs11)
pdf-app cert list --source pkcs11

# Search certificates
pdf-app cert search "John"

# Show detailed certificate info
pdf-app cert info <fingerprint>

# JSON output for scripting
pdf-app cert list --json
```

### Digital Signatures

```bash
# Sign a PDF with default invisible signature
pdf-app sign pdf document.pdf --cert <fingerprint>

# Sign with PIN prompt
pdf-app sign pdf document.pdf --cert <fingerprint> --pin <pin>

# Sign with a specific profile
pdf-app sign pdf document.pdf --cert <fingerprint> --profile default-visible

# Sign with custom visible signature position
pdf-app sign pdf document.pdf --cert <fingerprint> \
  --page 1 --x 400 --y 50 --width 200 --height 80

# Specify output file
pdf-app sign pdf document.pdf --cert <fingerprint> --output signed.pdf

# Verify signatures in a PDF
pdf-app sign verify document.pdf
pdf-app sign verify document.pdf --json

# List signature profiles
pdf-app sign profile-list

# Show profile details
pdf-app sign profile-info default-visible
```

### Configuration

```bash
# View all configuration
pdf-app config get

# Get specific setting
pdf-app config get theme

# Set configuration value
pdf-app config set theme dark
pdf-app config set defaultZoom 150

# Reset to defaults
pdf-app config reset
```

### Logging

The CLI uses structured logging with slog:

```bash
# Text logging (default)
pdf-app --verbose pdf info document.pdf

# JSON logging (for log aggregation)
pdf-app --json --verbose pdf info document.pdf
```

## 🔐 Digital Signature Support

Digital signatures support:
- X.509 certificates from system keystores
- PKCS#12 certificate files (.p12, .pfx)
- PKCS#11 hardware tokens (smart cards, USB tokens)
- NSS databases (Firefox/Thunderbird certificates)
- PAdES (PDF Advanced Electronic Signatures) standard
- Visible and invisible signatures
- Signature profiles with customizable appearance
- Signature verification with full certificate chain validation

## 🤝 Development Philosophy

- **Performance First**: Built with Go for native performance
- **Security**: Proper certificate handling and validation
- **User Experience**: Modern, intuitive interface
- **Linux Native**: Optimized for Linux desktop environments

## 📝 License

TBD

## 🔗 Resources

- [Wails Documentation](https://wails.io)
- [UniPDF Documentation](https://unidoc.io/unipdf)
- [Go Documentation](https://go.dev)


## TODO:
Add configurable settings:
- Theme selection (light/dark and accent colors)
- Default zoom level
- Auto-save interval
- Certificates storage location (allow multiple locations)
- Token libraries paths (allow loading multiple PKCS#11 libraries to recognize different tokens)
- Have several signature profiles (with different display options visible/not visible, visible signature contents like name, date, image...; certificates, etc.)
- Be able to fill PDF forms
- Add OCR support for scanned documents (Maybe AI based?)


option for watermark background signature
