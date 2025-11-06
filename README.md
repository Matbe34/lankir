# PDF Editor Pro

A modern, high-performance PDF editor for Linux built with Go and Wails.

## 🚀 Features

### Current (v0.1.0)
- Modern desktop application interface
- Basic project structure and architecture

### Planned
- **PDF Viewing & Editing**
  - Open and view PDF documents
  - Page navigation and zoom
  - Text selection and search
  - Annotations and comments
  
- **Digital Signatures** (Priority)
  - Sign PDFs with X.509 certificates
  - Support for PKCS#11 hardware tokens
  - Certificate management
  - Signature verification
  - Timestamp support

- **Advanced Features**
  - PDF creation and conversion
  - Form filling
  - Page manipulation (merge, split, rotate)
  - OCR support
  - Encryption and permissions

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

1. **Install Wails CLI**:
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
   ```

### Development

Run in development mode with hot reload:
```bash
wails dev
```

### Building for Production

```bash
# Build optimized binary
wails build -clean

# The binary will be in ./build/bin/
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

## 🔐 Digital Signature Support

Digital signatures will support:
- X.509 certificates from system keystores
- PKCS#12 certificate files
- PKCS#11 hardware tokens (smart cards, USB tokens)
- PAdES (PDF Advanced Electronic Signatures) standard
- Long-term validation (LTV)

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
- Sidebar visibility
- Recent files list length
- Auto-save interval
- Certificates storage location (allow multiple locations)
- Token libraries paths (allow loading multiple PKCS#11 libraries to recognize different tokens)
- Have several signature profiles (with different display options visible/not visible, visible signature contents like name, date, image...; certificates, etc.)
- Be able to place visible signatures in different positions of the page (not only bottom left)
- Keyboard shortcuts customization (have default ones but be able to change them)
- Be able to fill PDF forms
- Add OCR support for scanned documents (Maybe AI based?)
