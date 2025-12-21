# Configuration Reference

Complete reference for PDF App configuration options.

## Configuration File

**Location:** `~/.config/pdf_app/config.json`

## Settings

### Appearance

#### `theme`
- **Type:** `string`
- **Default:** `"dark"`
- **Values:** `"dark"`, `"light"`
- **Description:** Application color theme

```bash
pdf-app config set theme light
```

#### `accentColor`
- **Type:** `string`
- **Default:** `"#007acc"`
- **Format:** Hex color code
- **Description:** Primary accent color for UI elements

```bash
pdf-app config set accentColor "#ff6600"
```

### Viewer

#### `defaultZoom`
- **Type:** `integer`
- **Default:** `100`
- **Range:** `25` - `400`
- **Description:** Initial zoom percentage when opening PDFs

```bash
pdf-app config set defaultZoom 150
```

#### `showLeftSidebar`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Show thumbnail sidebar on startup

```bash
pdf-app config set showLeftSidebar false
```

#### `showRightSidebar`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Show properties sidebar on startup

```bash
pdf-app config set showRightSidebar true
```

#### `defaultViewMode`
- **Type:** `string`
- **Default:** `"scroll"`
- **Values:** `"scroll"`, `"single"`
- **Description:** Default page view mode

| Value | Description |
|-------|-------------|
| `scroll` | Continuous vertical scroll |
| `single` | One page at a time |

```bash
pdf-app config set defaultViewMode single
```

### Files

#### `recentFilesLength`
- **Type:** `integer`
- **Default:** `5`
- **Range:** `0` - `50`
- **Description:** Number of recent files to remember

```bash
pdf-app config set recentFilesLength 10
```

#### `autosaveInterval`
- **Type:** `integer`
- **Default:** `0`
- **Unit:** Seconds
- **Description:** Auto-save interval (0 = disabled)

```bash
pdf-app config set autosaveInterval 300  # 5 minutes
```

### Certificates

#### `certificateStores`
- **Type:** `array[string]`
- **Default:** Auto-detected system paths
- **Description:** Directories to scan for certificate files (.p12, .pfx)

**Default locations scanned:**
- `/etc/ssl/certs` (system)
- `~/.pki/nssdb` (user)

**Security:** Paths must be:
- Absolute paths
- Within allowed directories (home or system cert dirs)
- Existing directories

```json
{
    "certificateStores": [
        "/etc/ssl/certs",
        "/home/user/.pki/nssdb",
        "/home/user/my-certificates"
    ]
}
```

#### `tokenLibraries`
- **Type:** `array[string]`
- **Default:** Auto-detected PKCS#11 modules
- **Description:** Paths to PKCS#11 shared libraries

**Default modules:**
- `/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so`
- `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so`

**Security:** Paths must be:
- Absolute paths
- Valid shared library extension (.so, .dylib, .dll)
- Existing files

```json
{
    "tokenLibraries": [
        "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
        "/usr/lib/softhsm/libsofthsm2.so"
    ]
}
```

### Advanced

#### `debugMode`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Enable debug logging

```bash
pdf-app config set debugMode true
```

#### `hardwareAccel`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Use GPU acceleration for rendering

Disable if experiencing graphics issues:
```bash
pdf-app config set hardwareAccel false
```

## Complete Example

```json
{
    "theme": "dark",
    "accentColor": "#007acc",
    "defaultZoom": 100,
    "showLeftSidebar": true,
    "showRightSidebar": false,
    "defaultViewMode": "scroll",
    "recentFilesLength": 5,
    "autosaveInterval": 0,
    "certificateStores": [
        "/etc/ssl/certs",
        "/home/user/.pki/nssdb"
    ],
    "tokenLibraries": [
        "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
        "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so"
    ],
    "debugMode": false,
    "hardwareAccel": true
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_APP_CONFIG_DIR` | Override configuration directory |
| `PDF_APP_DEBUG` | Enable debug mode (`1` or `true`) |

### Example

```bash
# Use custom config directory
PDF_APP_CONFIG_DIR=/tmp/pdf-app-test pdf-app config get

# Enable debug for one session
PDF_APP_DEBUG=1 pdf-app cert list
```

## Related Files

| File | Purpose |
|------|---------|
| `~/.config/pdf_app/config.json` | Main configuration |
| `~/.config/pdf_app/recent_files.json` | Recent file history |
| `~/.config/pdf_app/signature_profiles/` | Signature profiles |

## CLI Commands

```bash
# View all settings
pdf-app config get

# View specific setting
pdf-app config get theme

# Set a value
pdf-app config set theme dark

# Reset to defaults
pdf-app config reset

# JSON output
pdf-app config get --json
```

## Backup and Restore

### Backup

```bash
cp ~/.config/pdf_app/config.json ~/config-backup.json
```

### Restore

```bash
cp ~/config-backup.json ~/.config/pdf_app/config.json
```

### Export/Import

```bash
# Export
pdf-app config get --json > pdf-app-settings.json

# Import (replace file)
cp pdf-app-settings.json ~/.config/pdf_app/config.json
```
