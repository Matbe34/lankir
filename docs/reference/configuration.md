# Configuration Reference

Complete reference for Lankir configuration options.

## Configuration File

**Location:** `~/.config/lankir/config.json`

## Settings

### Appearance

#### `theme`
- **Type:** `string`
- **Default:** `"dark"`
- **Values:** `"dark"`, `"light"`
- **Description:** Application color theme

```bash
lankir config set theme light
```

#### `accentColor`
- **Type:** `string`
- **Default:** `"#007acc"`
- **Format:** Hex color code
- **Description:** Primary accent color for UI elements

```bash
lankir config set accentColor "#ff6600"
```

### Viewer

#### `defaultZoom`
- **Type:** `integer`
- **Default:** `100`
- **Range:** `25` - `400`
- **Description:** Initial zoom percentage when opening PDFs

```bash
lankir config set defaultZoom 150
```

#### `showLeftSidebar`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Show thumbnail sidebar on startup

```bash
lankir config set showLeftSidebar false
```

#### `showRightSidebar`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Show properties sidebar on startup

```bash
lankir config set showRightSidebar true
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
lankir config set defaultViewMode single
```

### Files

#### `recentFilesLength`
- **Type:** `integer`
- **Default:** `5`
- **Range:** `0` - `50`
- **Description:** Number of recent files to remember

```bash
lankir config set recentFilesLength 10
```

#### `autosaveInterval`
- **Type:** `integer`
- **Default:** `0`
- **Unit:** Seconds
- **Description:** Auto-save interval (0 = disabled)

```bash
lankir config set autosaveInterval 300  # 5 minutes
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
lankir config set debugMode true
```

#### `hardwareAccel`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Use GPU acceleration for rendering

Disable if experiencing graphics issues:
```bash
lankir config set hardwareAccel false
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
| `LANKIR_CONFIG_DIR` | Override configuration directory |
| `LANKIR_DEBUG` | Enable debug mode (`1` or `true`) |

### Example

```bash
# Use custom config directory
LANKIR_CONFIG_DIR=/tmp/lankir-test lankir config get

# Enable debug for one session
LANKIR_DEBUG=1 lankir cert list
```

## Related Files

| File | Purpose |
|------|---------|
| `~/.config/lankir/config.json` | Main configuration |
| `~/.config/lankir/recent_files.json` | Recent file history |
| `~/.config/lankir/signature_profiles/` | Signature profiles |

## CLI Commands

```bash
# View all settings
lankir config get

# View specific setting
lankir config get theme

# Set a value
lankir config set theme dark

# Reset to defaults
lankir config reset

# JSON output
lankir config get --json
```

## Backup and Restore

### Backup

```bash
cp ~/.config/lankir/config.json ~/config-backup.json
```

### Restore

```bash
cp ~/config-backup.json ~/.config/lankir/config.json
```

### Export/Import

```bash
# Export
lankir config get --json > lankir-settings.json

# Import (replace file)
cp lankir-settings.json ~/.config/lankir/config.json
```
