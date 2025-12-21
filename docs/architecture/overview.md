# Architecture Overview

PDF App is a hybrid desktop application combining a Go backend with a web-based frontend, built using the Wails framework.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PDF App                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Frontend (Web)                        │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │ Viewer  │ │ Sidebar │ │ Dialogs │ │ Settings    │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘   │   │
│  │       │           │           │              │          │   │
│  │  ┌────┴───────────┴───────────┴──────────────┴────┐    │   │
│  │  │              State Management                   │    │   │
│  │  │         (state.js, eventEmitter.js)            │    │   │
│  │  └────────────────────┬───────────────────────────┘    │   │
│  └───────────────────────┼────────────────────────────────┘   │
│                          │ Wails Bindings                      │
│  ┌───────────────────────┼────────────────────────────────┐   │
│  │                    Backend (Go)                         │   │
│  │  ┌────────────────────┴───────────────────────────┐    │   │
│  │  │              Service Layer                      │    │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────────────┐   │    │   │
│  │  │  │   PDF   │ │  Config │ │    Signature    │   │    │   │
│  │  │  │ Service │ │ Service │ │     Service     │   │    │   │
│  │  │  └────┬────┘ └────┬────┘ └────────┬────────┘   │    │   │
│  │  └───────┼───────────┼───────────────┼────────────┘    │   │
│  │          │           │               │                  │   │
│  │  ┌───────┴───────────┴───────────────┴────────────┐    │   │
│  │  │              External Libraries                 │    │   │
│  │  │  ┌────────┐ ┌─────────┐ ┌───────┐ ┌────────┐   │    │   │
│  │  │  │ MuPDF  │ │ pdfsign │ │ PKCS  │ │  NSS   │   │    │   │
│  │  │  │(go-fitz)│ │         │ │ #11   │ │ (CGO)  │   │    │   │
│  │  │  └────────┘ └─────────┘ └───────┘ └────────┘   │    │   │
│  │  └────────────────────────────────────────────────┘    │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Execution Modes

PDF App operates in two modes from a single binary:

### GUI Mode
```bash
pdf-app  # No arguments → launches Wails GUI
```

The application embeds the frontend assets and runs a WebView window with the Go backend.

### CLI Mode
```bash
pdf-app <command> [args]  # Any arguments → CLI via Cobra
```

Commands are processed by Cobra command handlers without launching any GUI.

## Key Components

### Frontend
- **Technology**: Vanilla JavaScript, HTML, CSS (Tailwind)
- **No framework**: Pure ES6 modules, no React/Vue/etc.
- **Build**: Tailwind CSS compilation only
- **Communication**: Auto-generated Wails bindings

### Backend
- **Language**: Go 1.24+
- **Framework**: Wails v2
- **PDF Engine**: MuPDF via go-fitz (CGO)
- **Signing**: digitorus/pdfsign
- **CLI**: Cobra

### External Dependencies

| Library | Purpose | Binding |
|---------|---------|---------|
| MuPDF | PDF rendering | CGO (go-fitz) |
| pdfsign | PDF signing | Pure Go |
| miekg/pkcs11 | Hardware tokens | Pure Go |
| NSS | Browser certs | CGO |

## Data Flow

### Opening a PDF

```
User clicks Open → Frontend calls PDFService.OpenPDF()
                      ↓
              Wails marshals call to Go
                      ↓
              PDFService.OpenPDF() runs
                      ↓
              go-fitz opens PDF via MuPDF
                      ↓
              Returns metadata to frontend
                      ↓
              Frontend updates UI
```

### Signing a PDF

```
User clicks Sign → Frontend collects parameters
                      ↓
              SignatureService.SignPDF()
                      ↓
              Certificate lookup (PKCS#11/12/NSS)
                      ↓
              pdfsign creates signature
                      ↓
              Returns path to signed PDF
                      ↓
              Frontend shows success
```

## File Structure

```
pdf_app/
├── main.go                 # Entry point, mode router
├── app.go                  # Wails app wrapper
├── cmd/cli/                # Cobra CLI commands
├── internal/
│   ├── config/             # Configuration service
│   ├── pdf/                # PDF operations
│   └── signature/          # Signing subsystem
│       ├── pkcs11/         # Hardware tokens
│       ├── pkcs12/         # Certificate files
│       └── nss/            # Browser certs
├── frontend/
│   ├── src/                # Source files
│   │   ├── index.html
│   │   ├── style.css
│   │   └── js/             # JavaScript modules
│   └── wailsjs/            # Auto-generated bindings
└── docs/                   # This documentation
```

## Design Principles

### 1. Single Binary
Everything compiles into one executable—GUI, CLI, and all dependencies.

### 2. Offline First
No network required for core functionality. Only optional features (geolocation) use network.

### 3. Native Integration
Uses system certificate stores, respects XDG directories, integrates with desktop environments.

### 4. Security by Default
- Hardware token support (keys never leave device)
- Path validation for all file operations
- Input sanitization throughout

## Next Steps

- [Backend Architecture](backend.md) - Go service design
- [Frontend Architecture](frontend.md) - JavaScript module structure
- [Signature System](signature-system.md) - Certificate and signing details
- [Wails Integration](wails-integration.md) - Frontend-backend binding
