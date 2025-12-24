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

### Package Manager (Recommended)

The recommended way to install Lankir is through the package repository, which enables easy installation and updates.

#### Debian/Ubuntu

```bash
# Add the Lankir repository
curl -1sLf 'https://dl.cloudsmith.io/public/matbe34/lankir/setup.deb.sh' | sudo -E bash

# Install Lankir
sudo apt update
sudo apt install lankir
```

**Supported versions:**
- Ubuntu 24.04 (Noble Numbat)
- Ubuntu 22.04 (Jammy Jellyfish)
- Ubuntu 20.04 (Focal Fossa)
- Debian 12 (Bookworm)
- Debian 11 (Bullseye)

#### Fedora/RHEL/AlmaLinux

```bash
# Add the Lankir repository
curl -1sLf 'https://dl.cloudsmith.io/public/matbe34/lankir/setup.rpm.sh' | sudo -E bash

# Install Lankir
sudo dnf install lankir
```

**Supported versions:**
- Fedora 40, 39
- RHEL 9, 8
- AlmaLinux 9, 8
- Rocky Linux 9, 8

### Manual Package Installation

If you prefer not to add a repository, download and install packages manually from [Releases](https://github.com/Matbe34/lankir/releases):

**Debian/Ubuntu (.deb):**
```bash
# Download the .deb package
wget https://github.com/Matbe34/lankir/releases/latest/download/lankir_amd64.deb

# Install with dependencies
sudo apt install ./lankir_amd64.deb
```

**Fedora/RHEL (.rpm):**
```bash
# Download and install
wget https://github.com/Matbe34/lankir/releases/latest/download/lankir.x86_64.rpm
sudo dnf install ./lankir.x86_64.rpm
```

**openSUSE (.rpm):**
```bash
wget https://github.com/Matbe34/lankir/releases/latest/download/lankir.x86_64.rpm
sudo zypper install ./lankir.x86_64.rpm
```

:::{warning}
Manual package installation does **not** provide automatic updates. You'll need to manually download and install new versions.
:::

### AppImage (Universal)

The AppImage is fully self-contained and works on any Linux distribution:

```bash
# Download the latest release
wget https://github.com/Matbe34/lankir/releases/latest/download/lankir-x86_64.AppImage

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
