# Release v0.1.1

**Release Date:** 2025-12-24

---

## Summary

This release includes:
- ✨ 1 new feature(s)
- 🐛 1 bug fix(es)

---

## Changes

### ✨ Features

- Add .deb and .rpm packaging support (`f630970`)

### 🐛 Bug Fixes

- Small fixes on tasks and ci/cd (`9b9f38c`)

### 🔧 Maintenance

- Update intallation methods (`c2fc523`)

### 📦 Other Changes

- Fix package release yaml (`d805e46`)
- Update release yaml (`3750890`)
- Adjust taskfile (`82362d9`)
- Fix github actions (`6dcab94`)
- Fix github actions (`92a79f5`)
- Fix github actions (`b93201c`)
- Add GitHub Actions workflow for running tests (`f4f5b6d`)

---

## Installation

### AppImage (Recommended)

```bash
# Download
curl -LO https://github.com/Matbe34/lankir/releases/download/v0.1.1/lankir-0.1.1-x86_64.AppImage

# Make executable
chmod +x lankir-0.1.1-x86_64.AppImage

# Run
./lankir-0.1.1-x86_64.AppImage
```

### Debian/Ubuntu (.deb)

```bash
# Download
wget https://github.com/Matbe34/lankir/releases/download/v0.1.1/lankir_0.1.1_amd64.deb

# Install
sudo apt install ./lankir_0.1.1_amd64.deb
```

### RHEL/Fedora/CentOS (.rpm)

```bash
# Download
wget https://github.com/Matbe34/lankir/releases/download/v0.1.1/lankir-0.1.1-1.x86_64.rpm

# Install (Fedora/RHEL 8+)
sudo dnf install lankir-0.1.1-1.x86_64.rpm

# Install (CentOS/RHEL 7)
sudo yum install lankir-0.1.1-1.x86_64.rpm
```

### Static Binary

Requires GTK3, WebKit2GTK, and NSS libraries on target system.

```bash
# Download
curl -LO https://github.com/Matbe34/lankir/releases/download/v0.1.1/lankir_static

# Make executable
chmod +x lankir_static

# Run
./lankir_static
```

---

## Full Changelog

**Full Changelog**: https://github.com/Matbe34/lankir/compare/v0.1.0...v0.1.1
