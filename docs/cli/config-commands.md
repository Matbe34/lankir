# Config Commands

Commands for managing Lankir configuration.

## config get

Get configuration values.

```bash
lankir config get [key] [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Get all configuration
lankir config get

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
lankir config get theme
# Output: theme: dark

# JSON output
lankir config get --json
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
lankir config set <key> <value>
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
lankir config set theme light
# Output: Set theme = light

# Set zoom level
lankir config set defaultZoom 150
# Output: Set defaultZoom = 150

# Enable debug mode
lankir config set debugMode true
# Output: Set debugMode = true

# Set accent color
lankir config set accentColor "#ff6600"
# Output: Set accentColor = #ff6600
```

### Array Values

For array settings like `certificateStores` and `tokenLibraries`, edit the config file directly:

```bash
# View current array value
lankir config get certificateStores

# Edit config file
nano ~/.config/lankir/config.json
```

## config reset

Reset all configuration to defaults.

```bash
lankir config reset
```

### Example

```bash
lankir config reset
# Output: Configuration reset to defaults
```

:::{warning}
This removes all custom settings including certificate store paths and token libraries.
:::

## Configuration File

### Location

```
~/.config/lankir/config.json
```

### Manual Editing

```bash
# Edit configuration
nano ~/.config/lankir/config.json

# Validate JSON
python3 -m json.tool ~/.config/lankir/config.json
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
cp ~/.config/lankir/config.json ~/.config/lankir/config.json.bak
echo "Configuration backed up"
```

### Restore Configuration

```bash
#!/bin/bash
# Restore from backup
if [ -f ~/.config/lankir/config.json.bak ]; then
    cp ~/.config/lankir/config.json.bak ~/.config/lankir/config.json
    echo "Configuration restored"
else
    echo "No backup found"
fi
```

### Export Settings

```bash
#!/bin/bash
# Export configuration for sharing
lankir config get --json > lankir-config-export.json
echo "Configuration exported to lankir-config-export.json"
```

### Import Settings

```bash
#!/bin/bash
# Import configuration (overwrites current)
if [ -f "$1" ]; then
    cp "$1" ~/.config/lankir/config.json
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
lankir config set theme dark

# Set higher default zoom for readability
lankir config set defaultZoom 125

# Enable debug mode during setup
lankir config set debugMode true

# Verify settings
lankir config get

echo "Setup complete!"
```

### Toggle Debug Mode

```bash
#!/bin/bash
# Toggle debug mode
current=$(lankir config get debugMode --json | jq -r '.debugMode')
if [ "$current" = "true" ]; then
    lankir config set debugMode false
    echo "Debug mode disabled"
else
    lankir config set debugMode true
    echo "Debug mode enabled"
fi
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LANKIR_CONFIG_DIR` | Override config directory |
| `LANKIR_DEBUG` | Enable debug mode (`1` or `true`) |

### Example

```bash
# Use temporary config directory
LANKIR_CONFIG_DIR=/tmp/lankir-test lankir config get

# Enable debug for single command
LANKIR_DEBUG=1 lankir cert list
```

## Troubleshooting

### Config File Corrupted

```bash
# Reset to defaults
lankir config reset

# Or manually delete
rm ~/.config/lankir/config.json
```

### Permission Issues

```bash
# Fix permissions
chmod 700 ~/.config/lankir
chmod 600 ~/.config/lankir/config.json
```

### Invalid JSON

```bash
# Validate config file
python3 -m json.tool ~/.config/lankir/config.json

# If invalid, reset
lankir config reset
```

## Next Steps

- [Configuration Reference](../reference/configuration.md) - Complete settings documentation
- [Installation](../getting-started/installation.md) - Initial setup
