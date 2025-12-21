# Configuration

PDF App stores all configuration in `~/.config/pdf_app/`.

```{figure} ../_static/screenshots/settings-panel.png
:alt: Settings panel
:width: 80%
:align: center

*Settings panel showing theme, viewer, and certificate configuration options*
```

```{note}
**Screenshot needed:** `_static/screenshots/settings-panel.png` — The settings/preferences panel showing various configuration options.
```

## Configuration Files

| File | Purpose |
|------|---------|
| `config.json` | Main application settings |
| `recent_files.json` | Recently opened PDFs |
| `signature_profiles/` | Signature profile definitions |

## Settings Reference

### Appearance

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | UI theme: `"dark"` or `"light"` |
| `accentColor` | string | `"#007acc"` | Primary accent color (hex) |

```bash
# Change theme
pdf-app config set theme light

# Set accent color
pdf-app config set accentColor "#ff6600"
```

### Viewer

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultZoom` | int | `100` | Initial zoom percentage |
| `showLeftSidebar` | bool | `true` | Show thumbnail sidebar |
| `showRightSidebar` | bool | `false` | Show properties sidebar |
| `defaultViewMode` | string | `"scroll"` | View mode: `"scroll"` or `"single"` |

```bash
# Set default zoom to 150%
pdf-app config set defaultZoom 150

# Change view mode
pdf-app config set defaultViewMode single
```

### Files

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `recentFilesLength` | int | `5` | Number of recent files to remember |
| `autosaveInterval` | int | `0` | Autosave interval in seconds (0 = disabled) |

### Certificates

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `certificateStores` | array | (auto) | Paths to scan for certificates |
| `tokenLibraries` | array | (auto) | PKCS#11 module paths |

#### Certificate Stores

Directories where PDF App looks for `.p12`/`.pfx` certificate files:

```json
{
  "certificateStores": [
    "/etc/ssl/certs",
    "/home/user/.pki/nssdb",
    "/home/user/certificates"
  ]
}
```

Add a custom certificate directory:
```bash
# Note: Directories must be absolute paths within home or system cert dirs
pdf-app config set certificateStores '["/home/user/my-certs"]'
```

#### Token Libraries

PKCS#11 shared library paths for hardware tokens:

```json
{
  "tokenLibraries": [
    "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
    "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so"
  ]
}
```

### Advanced

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `debugMode` | bool | `false` | Enable debug logging |
| `hardwareAccel` | bool | `true` | Use GPU acceleration |

```bash
# Enable debug mode
pdf-app config set debugMode true

# Disable hardware acceleration (for troubleshooting)
pdf-app config set hardwareAccel false
```

## Viewing Configuration

```bash
# Show all settings
pdf-app config get

# Show specific setting
pdf-app config get theme

# JSON output (for scripting)
pdf-app config get --json
```

## Resetting Configuration

To reset all settings to defaults:

```bash
pdf-app config reset
```

Or manually delete the config file:

```bash
rm ~/.config/pdf_app/config.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_APP_CONFIG_DIR` | Override config directory |
| `PDF_APP_DEBUG` | Enable debug output (`1` or `true`) |

## Configuration Locations

PDF App follows the XDG Base Directory Specification:

| Data Type | Location |
|-----------|----------|
| Config | `~/.config/pdf_app/` |
| Cache | `~/.cache/pdf_app/` |
| Data | `~/.local/share/pdf_app/` |

## Next Steps

- [Certificate Management](../user-guide/certificates.md) - Configure certificate sources
- [Signature Profiles](../user-guide/signature-profiles.md) - Create signing profiles
