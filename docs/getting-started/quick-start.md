# Quick Start

Get started with Lankir in 5 minutes.

## Launching the Application

### GUI Mode

Run Lankir without arguments to launch the graphical interface:

```bash
lankir
```

Or double-click the AppImage/desktop shortcut.

```{figure} ../_static/screenshots/main-window.png
:alt: Lankir main window after launch
:width: 100%

*Lankir main window with welcome screen*
```

```{note}
**Screenshot needed:** `_static/screenshots/main-window.png` — The main application window after launch, showing the welcome screen or empty state.
```

### CLI Mode

Pass any argument to use CLI mode:

```bash
lankir pdf info document.pdf
```

## Opening a PDF

### Via GUI

1. Click **File → Open** or press `Ctrl+O`
2. Select a PDF file from the file browser
3. The PDF opens in the main viewer

```{figure} ../_static/screenshots/pdf-open.png
:alt: PDF document open in viewer
:width: 100%

*PDF document displayed with thumbnail sidebar*
```

```{note}
**Screenshot needed:** `_static/screenshots/pdf-open.png` — A PDF document open in the viewer with the thumbnail sidebar visible on the left.
```

### Via CLI

```bash
# View PDF information
lankir pdf info document.pdf

# Render a specific page
lankir pdf render document.pdf --page 1 --output page1.png
```

### Via Drag & Drop

Drag a PDF file from your file manager and drop it on the Lankir window.

## Navigating Documents

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Next page | `→` or `Page Down` |
| Previous page | `←` or `Page Up` |
| First page | `Home` |
| Last page | `End` |
| Zoom in | `Ctrl++` or `Ctrl+Scroll Up` |
| Zoom out | `Ctrl+-` or `Ctrl+Scroll Down` |
| Fit width | `Ctrl+1` |
| Fit page | `Ctrl+2` |

### Sidebar

The left sidebar shows:
- **Thumbnails**: Click to jump to any page
- **Recent Files**: Quick access to previously opened documents

## Signing Your First PDF

### Prerequisites

You need a digital certificate from one of these sources:
- PKCS#12 file (`.p12` or `.pfx`)
- Hardware token (smart card, USB token)
- Browser certificate store (Firefox/Chrome NSS database)

### Quick Sign (GUI)

1. Open a PDF document
2. Click **Sign** in the toolbar
3. Select a certificate from the dropdown
4. Enter PIN if required
5. Click **Sign Document**

```{figure} ../_static/screenshots/sign-dialog.png
:alt: Signature dialog with certificate selection
:width: 80%

*Signature dialog showing certificate selection and profile options*
```

```{note}
**Screenshot needed:** `_static/screenshots/sign-dialog.png` — The signature dialog showing the certificate dropdown, PIN field, and sign button.
```

The signed PDF saves as `original_signed.pdf`.

### Verify Signature

To verify an existing signature:

```bash
lankir sign verify signed_document.pdf
```

Or in the GUI, open the PDF and check the signature panel.

## Viewing Certificate Information

List available certificates:

```bash
# CLI
lankir cert list

# Show only valid certificates
lankir cert list --valid-only
```

In the GUI, go to **Settings → Certificates** to browse all available certificates.

## Configuration

Lankir stores settings in `~/.config/lankir/config.json`.

### Common Settings

```bash
# View current config
lankir config get

# Change theme
lankir config set theme dark

# Set default zoom
lankir config set defaultZoom 125
```

## Next Steps

Now that you have the basics:

- [Certificate Management](../user-guide/certificates.md) - Set up certificates
- [Signing PDFs](../user-guide/signing.md) - Advanced signing options
- [Signature Profiles](../user-guide/signature-profiles.md) - Customize appearance
- [CLI Reference](../cli/overview.md) - Automation and scripting
