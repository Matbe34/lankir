# Configuration

Lankir stores all configuration in `~/.config/lankir/`.

```{figure} ../_static/screenshots/settings-panel.png
:alt: Settings panel
:width: 80%
:align: center

*Settings panel showing theme, viewer, and certificate configuration options*
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
lankir config set theme light

# Set accent color
lankir config set accentColor "#ff6600"
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
lankir config set defaultZoom 150

# Change view mode
lankir config set defaultViewMode single
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

Directories where Lankir looks for `.p12`/`.pfx` certificate files:

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
lankir config set certificateStores '["/home/user/my-certs"]'
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
lankir config set debugMode true

# Disable hardware acceleration (for troubleshooting)
lankir config set hardwareAccel false
```

## Viewing Configuration

```bash
# Show all settings
lankir config get

# Show specific setting
lankir config get theme

# JSON output (for scripting)
lankir config get --json
```

## Resetting Configuration

To reset all settings to defaults:

```bash
lankir config reset
```

Or manually delete the config file:

```bash
rm ~/.config/lankir/config.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LANKIR_CONFIG_DIR` | Override config directory |
| `LANKIR_DEBUG` | Enable debug output (`1` or `true`) |

## Configuration Locations

Lankir follows the XDG Base Directory Specification:

| Data Type | Location |
|-----------|----------|
| Config | `~/.config/lankir/` |
| Cache | `~/.cache/lankir/` |
| Data | `~/.local/share/lankir/` |

## Next Steps

- [Certificate Management](../user-guide/certificates.md) - Configure certificate sources
- [Signature Profiles](../user-guide/signature-profiles.md) - Create signing profiles
