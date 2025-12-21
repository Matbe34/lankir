# Config Commands

Commands for managing PDF App configuration.

## config get

Get configuration values.

```bash
pdf-app config get [key] [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Get all configuration
pdf-app config get

# Output:
Current Configuration:

Appearance:
  Theme:        dark
  Accent Color: #007acc

Viewer:
  Default Zoom:       100%
  Show Left Sidebar:  true
  Show Right Sidebar: false
  Default View Mode:  scroll

Files:
  Recent Files Length: 5
  Autosave Interval:   0 seconds

Certificates:
  Certificate Stores:  [/etc/ssl/certs /home/user/.pki/nssdb]
  Token Libraries:     [/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so]

Advanced:
  Debug Mode:        false
  Hardware Accel:    true

# Get specific value
pdf-app config get theme
# Output: theme: dark

# JSON output
pdf-app config get --json
```

### JSON Output

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
    "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so"
  ],
  "debugMode": false,
  "hardwareAccel": true
}
```

## config set

Set a configuration value.

```bash
pdf-app config set <key> <value>
```

### Available Keys

| Key | Type | Valid Values |
|-----|------|--------------|
| `theme` | string | `dark`, `light` |
| `accentColor` | string | Hex color (e.g., `#007acc`) |
| `defaultZoom` | int | 25-400 |
| `showLeftSidebar` | bool | `true`, `false` |
| `showRightSidebar` | bool | `true`, `false` |
| `defaultViewMode` | string | `scroll`, `single` |
| `recentFilesLength` | int | 0-50 |
| `autosaveInterval` | int | 0+ (seconds, 0=disabled) |
| `debugMode` | bool | `true`, `false` |
| `hardwareAccel` | bool | `true`, `false` |

### Examples

```bash
# Set theme
pdf-app config set theme light
# Output: Set theme = light

# Set zoom level
pdf-app config set defaultZoom 150
# Output: Set defaultZoom = 150

# Enable debug mode
pdf-app config set debugMode true
# Output: Set debugMode = true

# Set accent color
pdf-app config set accentColor "#ff6600"
# Output: Set accentColor = #ff6600
```

### Array Values

For array settings like `certificateStores` and `tokenLibraries`, edit the config file directly:

```bash
# View current array value
pdf-app config get certificateStores

# Edit config file
nano ~/.config/pdf_app/config.json
```

## config reset

Reset all configuration to defaults.

```bash
pdf-app config reset
```

### Example

```bash
pdf-app config reset
# Output: Configuration reset to defaults
```

:::{warning}
This removes all custom settings including certificate store paths and token libraries.
:::

## Configuration File

### Location

```
~/.config/pdf_app/config.json
```

### Manual Editing

```bash
# Edit configuration
nano ~/.config/pdf_app/config.json

# Validate JSON
python3 -m json.tool ~/.config/pdf_app/config.json
```

### Default Configuration

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
  "certificateStores": [],
  "tokenLibraries": [],
  "debugMode": false,
  "hardwareAccel": true
}
```

## Scripting Examples

### Backup Configuration

```bash
#!/bin/bash
# Backup current configuration
cp ~/.config/pdf_app/config.json ~/.config/pdf_app/config.json.bak
echo "Configuration backed up"
```

### Restore Configuration

```bash
#!/bin/bash
# Restore from backup
if [ -f ~/.config/pdf_app/config.json.bak ]; then
    cp ~/.config/pdf_app/config.json.bak ~/.config/pdf_app/config.json
    echo "Configuration restored"
else
    echo "No backup found"
fi
```

### Export Settings

```bash
#!/bin/bash
# Export configuration for sharing
pdf-app config get --json > pdf-app-config-export.json
echo "Configuration exported to pdf-app-config-export.json"
```

### Import Settings

```bash
#!/bin/bash
# Import configuration (overwrites current)
if [ -f "$1" ]; then
    cp "$1" ~/.config/pdf_app/config.json
    echo "Configuration imported from $1"
else
    echo "Usage: $0 <config-file.json>"
fi
```

### Setup Script

```bash
#!/bin/bash
# Initial setup for signing workstation

# Set theme
pdf-app config set theme dark

# Set higher default zoom for readability
pdf-app config set defaultZoom 125

# Enable debug mode during setup
pdf-app config set debugMode true

# Verify settings
pdf-app config get

echo "Setup complete!"
```

### Toggle Debug Mode

```bash
#!/bin/bash
# Toggle debug mode
current=$(pdf-app config get debugMode --json | jq -r '.debugMode')
if [ "$current" = "true" ]; then
    pdf-app config set debugMode false
    echo "Debug mode disabled"
else
    pdf-app config set debugMode true
    echo "Debug mode enabled"
fi
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_APP_CONFIG_DIR` | Override config directory |
| `PDF_APP_DEBUG` | Enable debug mode (`1` or `true`) |

### Example

```bash
# Use temporary config directory
PDF_APP_CONFIG_DIR=/tmp/pdf-app-test pdf-app config get

# Enable debug for single command
PDF_APP_DEBUG=1 pdf-app cert list
```

## Troubleshooting

### Config File Corrupted

```bash
# Reset to defaults
pdf-app config reset

# Or manually delete
rm ~/.config/pdf_app/config.json
```

### Permission Issues

```bash
# Fix permissions
chmod 700 ~/.config/pdf_app
chmod 600 ~/.config/pdf_app/config.json
```

### Invalid JSON

```bash
# Validate config file
python3 -m json.tool ~/.config/pdf_app/config.json

# If invalid, reset
pdf-app config reset
```

## Next Steps

- [Configuration Reference](../reference/configuration.md) - Complete settings documentation
- [Installation](../getting-started/installation.md) - Initial setup
