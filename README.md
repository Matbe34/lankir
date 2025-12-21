<p align="center">
  <img src="build/appimage/AppDir/pdf-app.svg" alt="PDF App Logo" width="128" height="128">
</p>

<h1 align="center">PDF App</h1>

<p align="center">
  <strong>A modern, high-performance PDF editor for Linux with advanced digital signature support</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#building">Building</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.24-00ADD8?logo=go&logoColor=white" alt="Go 1.24">
  <img src="https://img.shields.io/badge/Wails-2.10-FF4081?logo=wails&logoColor=white" alt="Wails 2.10">
  <img src="https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Overview

PDF App is a desktop PDF editor built specifically for Linux, combining the power of Go with a modern web-based UI through Wails. It provides comprehensive PDF viewing capabilities and enterprise-grade digital signature support, including hardware tokens (smart cards) and multiple certificate backends.

The same binary works as both a **GUI application** and a **CLI tool**, making it perfect for both interactive use and automated workflows.

### Key Highlights

- 🖥️ **Native Desktop App** — Fast, responsive UI with GTK3 integration
- 🔐 **Advanced Digital Signatures** — Support for PKCS#11, PKCS#12, and NSS certificates
- 💻 **Dual Mode Operation** — GUI for interactive use, CLI for scripting and automation
- 📦 **Portable Deployment** — AppImage available for distribution-agnostic installation
- ⚡ **High Performance** — Go backend with MuPDF for fast PDF rendering

---

## Features

### PDF Viewing & Operations
- Open and view PDF documents with smooth rendering
- Page thumbnails and navigation
- Zoom controls with customizable default levels
- Extract PDF metadata (title, author, page count)
- Render pages to PNG at custom DPI
- Generate thumbnails for preview

### Digital Signatures
- **Sign PDFs** with X.509 certificates
- **Multiple certificate sources:**
  - PKCS#12 files (`.p12`, `.pfx`)
  - PKCS#11 hardware tokens (smart cards, USB tokens, HSMs)
  - NSS databases (Firefox/Thunderbird certificates)
- **Visible and invisible signatures** with customizable appearance
- **Signature profiles** for reusable signing configurations
- **Signature verification** with full certificate chain validation
- Position control for visible signatures (page, coordinates, size)
- Custom signature appearance (signer name, timestamp, location, logo)

### Certificate Management
- List certificates from all configured sources
- Filter by source, validity, or search term
- View detailed certificate information
- Validate certificate status and key usage
- Auto-discovery of system certificate stores

### Configuration
- Persistent settings stored in `~/.config/pdf_app/`
- Theme selection (light/dark)
- Customizable certificate store paths
- Configurable PKCS#11 module libraries
- Multiple signature profiles

---

## Installation

### Option 1: AppImage (Recommended)

Download the latest AppImage from [Releases](https://github.com/ferran/pdf_app/releases):

```bash
# Download the AppImage
wget https://github.com/ferran/pdf_app/releases/download/v0.1.0/pdf-app-0.1.0-x86_64.AppImage

# Make it executable
chmod +x pdf-app-0.1.0-x86_64.AppImage

# Run it
./pdf-app-0.1.0-x86_64.AppImage
```

The AppImage is fully self-contained and runs on any modern Linux distribution.

### Option 2: Static Binary

For the portable binary, install the required runtime dependencies:

**Ubuntu/Debian:**
```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.0-37 libnss3
```

**Fedora/RHEL:**
```bash
sudo dnf install gtk3 webkit2gtk3 nss
```

**Arch Linux:**
```bash
sudo pacman -S gtk3 webkit2gtk nss
```

Then download and run the binary:

```bash
# Download
wget https://github.com/ferran/pdf_app/releases/download/v0.1.0/pdf_app_static

# Make executable and move to PATH
chmod +x pdf_app_static
sudo mv pdf_app_static /usr/local/bin/pdf-app
```

---

## Usage

### Launching the GUI

Simply run the application without arguments:

```bash
pdf-app
```

Or explicitly:

```bash
pdf-app gui
```

### Using the CLI

Add any command to use CLI mode:

```bash
# Get help
pdf-app --help

# PDF operations
pdf-app pdf info document.pdf

# Certificate management
pdf-app cert list

# Sign a document
pdf-app sign pdf document.pdf signed.pdf --fingerprint <cert-fingerprint>
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open PDF |
| `Alt+S` | Sign PDF |
| `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Reset zoom |

---

## CLI Reference

### Global Flags

```bash
pdf-app [command] [flags]

Flags:
  -v, --verbose   Enable verbose logging (debug level)
      --json      Output logs in JSON format (for scripting)
  -h, --help      Help for pdf-app
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

# List only valid certificates that can sign
pdf-app cert list --valid-only

# Filter by source
pdf-app cert list --source pkcs11
pdf-app cert list --source pkcs12
pdf-app cert list --source nss

# Search certificates by name
pdf-app cert search "John Doe"

# Show detailed certificate info
pdf-app cert info <fingerprint>

# JSON output for scripting
pdf-app cert list --json
```

### Digital Signatures

```bash
# Sign with invisible signature (default)
pdf-app sign pdf document.pdf signed.pdf --fingerprint <fingerprint>

# Sign with PIN (for hardware tokens)
pdf-app sign pdf document.pdf signed.pdf --fingerprint <fingerprint> --pin <pin>

# Sign with a specific profile
pdf-app sign pdf document.pdf signed.pdf --fingerprint <fingerprint> --profile default-visible

# Sign with custom visible signature position
pdf-app sign pdf document.pdf signed.pdf --fingerprint <fingerprint> \
  --page 1 --x 400 --y 50 --width 200 --height 80

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

---

## Building

### Prerequisites

- **Go 1.24** or higher
- **Wails CLI v2** (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- **Task** runner (`go install github.com/go-task/task/v3/cmd/task@latest`)
- **Node.js** (for frontend build)
- **System libraries:**

  ```bash
  # Ubuntu/Debian
  sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev libnss3-dev
  
  # Fedora
  sudo dnf install gtk3-devel webkit2gtk3-devel nss-devel
  
  # Arch
  sudo pacman -S gtk3 webkit2gtk nss
  ```

### Build Commands

```bash
# Clone the repository
git clone https://github.com/ferran/pdf_app.git
cd pdf_app

# Install Go dependencies
go mod download

# Development mode with hot reload
task dev

# Production build (requires GTK3 on target)
task build

# Portable static build
task build-static

# AppImage (fully portable)
task appimage
```

### Available Tasks

| Task | Description |
|------|-------------|
| `task dev` | Development mode with hot reload |
| `task build` | Production build |
| `task build-static` | Portable binary for distribution |
| `task appimage` | Self-contained AppImage |
| `task test` | Run all tests (Go + JavaScript) |
| `task test-backend` | Run Go tests only |
| `task test-frontend` | Run JavaScript tests only |
| `task test-coverage` | Generate coverage reports |
| `task lint` | Run linters |
| `task clean` | Remove build artifacts |
| `task clean-all` | Deep clean including caches |

---

## Architecture

```
pdf_app/
├── main.go                     # Entry point (GUI/CLI router)
├── app.go                      # Wails app wrapper
├── cmd/cli/                    # Cobra CLI commands
│   ├── root.go                 # Root command & logging setup
│   ├── pdf.go                  # PDF operations
│   ├── cert.go                 # Certificate management
│   ├── sign.go                 # Signing operations
│   └── config.go               # Configuration commands
├── internal/
│   ├── config/                 # Configuration service
│   ├── pdf/                    # PDF service (go-fitz/MuPDF)
│   │   ├── service.go          # PDF operations
│   │   └── recent.go           # Recent files tracking
│   └── signature/              # Signature subsystem
│       ├── service.go          # Main signature service
│       ├── profile.go          # Signature profiles
│       ├── signing.go          # PDF signing logic
│       ├── verification.go     # Signature verification
│       ├── appearance.go       # Visible signature rendering
│       ├── pkcs11/             # Hardware token support
│       ├── pkcs12/             # .p12/.pfx file support
│       └── nss/                # NSS database support
└── frontend/
    ├── src/                    # Web UI (vanilla JS + Tailwind)
    └── wailsjs/                # Auto-generated Wails bindings
```

### Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Go 1.24 |
| Desktop Framework | Wails v2 |
| PDF Rendering | MuPDF (via go-fitz) |
| PDF Signing | digitorus/pdfsign |
| CLI Framework | Cobra |
| Logging | slog (structured) |
| Frontend | Vanilla JS + Tailwind CSS |
| Hardware Tokens | miekg/pkcs11 |

---

## Configuration

Configuration is stored in `~/.config/pdf_app/`:

| File | Purpose |
|------|---------|
| `config.json` | Application settings |
| `signature_profiles.json` | Saved signature profiles |
| `recent_files.json` | Recent files history |

### Configuration Options

```json
{
  "theme": "dark",
  "accentColor": "#3b82f6",
  "defaultZoom": 100,
  "showLeftSidebar": true,
  "showRightSidebar": true,
  "defaultViewMode": "scroll",
  "recentFilesLength": 10,
  "certificateStores": [
    "/home/user/.certificates"
  ],
  "tokenLibraries": [
    "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so"
  ],
  "debugMode": false,
  "hardwareAccel": true
}
```

---

## Hardware Token Support

PDF App supports PKCS#11 hardware tokens for enterprise-grade digital signatures:

### Supported Tokens

- **Smart Cards** (national ID cards, corporate cards)
- **USB Tokens** (YubiKey, SafeNet, Feitian)
- **Hardware Security Modules (HSMs)**

### Configuration

Add your PKCS#11 module to the configuration:

```bash
pdf-app config set tokenLibraries '["/usr/lib/opensc-pkcs11.so"]'
```

Common module paths:

| Distribution | OpenSC Module |
|--------------|---------------|
| Ubuntu/Debian | `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so` |
| Fedora/RHEL | `/usr/lib64/opensc-pkcs11.so` |
| Arch | `/usr/lib/opensc-pkcs11.so` |

---

## Troubleshooting

### Common Issues

**"No certificates found"**
- Check that certificate stores are configured: `pdf-app config get certificateStores`
- For hardware tokens, ensure the token is inserted and drivers are installed
- Verify PKCS#11 modules are accessible: `pdf-app config get tokenLibraries`

**"Failed to open PDF"**
- Ensure the file exists and is readable
- Check if the PDF is encrypted (password-protected PDFs not yet supported)

**"Signature verification failed"**
- The PDF may have been modified after signing
- Certificate may have expired or been revoked
- Trust chain may not be complete

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# GUI with debug logging
pdf-app --verbose gui

# CLI with JSON logging (for parsing)
pdf-app --json --verbose cert list
```

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `task test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Go code follows standard `gofmt` formatting
- Use meaningful variable and function names
- Write tests for new functionality
- Document exported functions and types

---

## Roadmap

### Planned Features

- [ ] PDF annotations and comments
- [ ] Text selection and search
- [ ] Timestamp Authority (TSA) support for signatures
- [ ] PDF form filling
- [ ] Page manipulation (merge, split, rotate)
- [ ] PDF creation and conversion
- [ ] Encryption and permissions management
- [ ] OCR support for scanned documents

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 Ferran

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Acknowledgments

- [Wails](https://wails.io) — Desktop application framework
- [MuPDF](https://mupdf.com) — PDF rendering engine
- [digitorus/pdfsign](https://github.com/digitorus/pdfsign) — PDF signing library
- [Cobra](https://github.com/spf13/cobra) — CLI framework
- [Tailwind CSS](https://tailwindcss.com) — CSS framework

---

<p align="center">
  Made with ❤️ for Linux
</p>
