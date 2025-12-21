# Installation

This guide covers installing Lankir on Linux systems.

## System Requirements

- **OS**: Linux (x86_64)
- **Desktop**: GTK3-compatible environment (GNOME, KDE, XFCE, etc.)
- **Memory**: 256MB RAM minimum, 512MB recommended
- **Disk**: 50MB for application, additional space for PDFs

### Optional Dependencies

For hardware token support:
- `p11-kit` - PKCS#11 module proxy
- `opensc` - Smart card tools and drivers
- `pcsc-lite` - PC/SC smart card daemon

## Installation Methods

### AppImage (Recommended)

The AppImage is fully self-contained and works on any Linux distribution:

```bash
# Download the latest release
wget https://github.com/ferran/lankir/releases/latest/download/lankir-x86_64.AppImage

# Make executable
chmod +x lankir-x86_64.AppImage

# Run
./lankir-x86_64.AppImage
```

:::{tip}
Move the AppImage to `~/.local/bin/` and rename it to `lankir` for easy access:
```bash
mv lankir-x86_64.AppImage ~/.local/bin/lankir
```
:::

### Building from Source

See the [Development Setup](../development/setup.md) guide for building from source.

## Verifying Installation

After installation, verify Lankir is working:

```bash
# Check version
lankir --version

# View help
lankir --help

# Launch GUI (no arguments)
lankir
```

## Hardware Token Setup

### Smart Card Reader

1. Install PC/SC daemon:
   ```bash
   # Debian/Ubuntu
   sudo apt install pcscd pcsc-tools

   # Fedora
   sudo dnf install pcsc-lite pcsc-tools

   # Arch
   sudo pacman -S pcsclite pcsc-tools
   ```

2. Start the service:
   ```bash
   sudo systemctl enable pcscd
   sudo systemctl start pcscd
   ```

3. Verify card detection:
   ```bash
   pcsc_scan
   ```

### PKCS#11 Modules

Lankir automatically detects common PKCS#11 modules:

| Module | Path | Use Case |
|--------|------|----------|
| p11-kit | `/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so` | Universal proxy |
| OpenSC | `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so` | Smart cards |

To add a custom module, see [Configuration](configuration.md#token-libraries).

## Next Steps

- [Quick Start Guide](quick-start.md) - Open your first PDF
- [Digital Signatures](../user-guide/signing.md) - Sign documents
- [CLI Overview](../cli/overview.md) - Command-line usage
