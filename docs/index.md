# PDF App Documentation

**A powerful desktop PDF viewer and digital signature tool for Linux.**

Sign PDFs with hardware tokens (PKCS#11), certificate files (PKCS#12), and browser certificate stores (NSS). Works as both a GUI application and CLI tool from a single binary.

```{figure} _static/screenshot.png
:alt: PDF App main interface showing PDF viewer with signature panel
:width: 100%
:class: screenshot-hero

*PDF App main interface with document viewer and signature capabilities*
```

```{note}
**Screenshot needed:** Replace `_static/screenshot.png` with a 1200×800 PNG showing the main application window with a PDF document open.
```

---

## Key Features

::::{grid} 2
:gutter: 3

:::{grid-item-card} 🐧 Native Linux Experience
Built specifically for Linux desktops with GTK3 integration. No Electron, no bloat—just a fast, responsive application.
:::

:::{grid-item-card} 🔐 Hardware Token Support
Sign PDFs with smart cards, USB tokens, and HSMs via PKCS#11. Private keys never leave your secure hardware.
:::

:::{grid-item-card} 📜 Multiple Certificate Sources
Use certificates from PKCS#12 files, system stores, Firefox, Chrome, or hardware tokens—all from one interface.
:::

:::{grid-item-card} ⚡ Dual Interface
Same binary works as GUI application or powerful CLI tool. Automate signing workflows with scripts.
:::

::::

---

## Quick Start

::::{grid} 2
:gutter: 3

:::{grid-item-card} 🚀 Installation
:link: getting-started/installation
:link-type: doc

Download and install PDF App on your Linux system.
:::

:::{grid-item-card} 📖 First Steps
:link: getting-started/quick-start
:link-type: doc

Open your first PDF and explore the interface.
:::

:::{grid-item-card} ✍️ Sign Documents
:link: user-guide/signing
:link-type: doc

Learn to sign PDFs with your certificates.
:::

:::{grid-item-card} 💻 CLI Reference
:link: cli/overview
:link-type: doc

Master command-line operations for automation.
:::

::::

## Documentation

```{toctree}
:maxdepth: 2
:caption: Getting Started

getting-started/installation
getting-started/quick-start
getting-started/configuration
```

```{toctree}
:maxdepth: 2
:caption: User Guide

user-guide/viewing-pdfs
user-guide/signing
user-guide/certificates
user-guide/signature-profiles
user-guide/verification
```

```{toctree}
:maxdepth: 2
:caption: Command Line

cli/overview
cli/pdf-commands
cli/cert-commands
cli/sign-commands
cli/config-commands
```

```{toctree}
:maxdepth: 2
:caption: Architecture

architecture/overview
architecture/backend
architecture/frontend
architecture/signature-system
architecture/wails-integration
```

```{toctree}
:maxdepth: 2
:caption: Development

development/setup
development/building
development/testing
development/contributing
```

```{toctree}
:maxdepth: 2
:caption: Reference

reference/api
reference/configuration
reference/troubleshooting
reference/faq
```

---

## Feature Overview

| Feature | Description |
|---------|-------------|
| **PDF Viewing** | High-quality rendering powered by MuPDF |
| **Digital Signatures** | Sign with PKCS#11 tokens, PKCS#12 files, or NSS databases |
| **Signature Verification** | Validate existing signatures and certificate chains |
| **Visible Signatures** | Customizable signature appearance with logos and text |
| **CLI Support** | Full command-line interface for automation and scripting |
| **Certificate Management** | Browse and manage certificates from multiple sources |

---

## Privacy & Security

- **Offline First**: All processing happens locally—no cloud services
- **Hardware Security**: Private keys on tokens never leave the device
- **No Telemetry**: No data collection or tracking
- **Open Source**: Full transparency—audit the code yourself

---

## License

PDF App is open source software. See the [LICENSE](https://github.com/ferran/pdf_app/blob/main/LICENSE) file for details.

---

## Index

- {ref}`genindex`
- {ref}`search`
