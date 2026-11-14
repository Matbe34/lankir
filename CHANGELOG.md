# Release v1.0.1

**Release Date:** 2026-11-14

---

## Added

- The sign panel checks the chosen certificate with its certificate authority
  (when Settings › Signing › Check revocation online is on) and won't sign
  with a revoked one: it says when the certificate was revoked and disables
  Sign. If the check can't be made, a quiet note says so and signing still
  works.
- `lankir sign verify --offline` checks revocation only from data in the PDF,
  whatever the setting.
- The package repositories also carry Debian 13 (trixie), Ubuntu 26.04
  (resolute) and Fedora 43, 44 and 45.

## Changed

- **Settings › Advanced › Hardware acceleration** now works: off, the app's
  web view draws without the graphics card. A change applies the next time
  Lankir starts.
- The Auto-save setting is gone from Settings; it never did anything. The
  `autosaveInterval` key stays in `config.json` and is ignored.
- `lankir config get` and `lankir config set` know every `config.json` key,
  `tsaUrl`, `checkRevocationOnline` and `signatureLocationLookup` included,
  and `lankir config get` without a key lists them all. `lankir config set`
  takes only the values Settings would store: `theme` light, dark or auto,
  `accentColor` as `#rrggbb`, `defaultZoom` from 10 to 400 and
  `recentFilesLength` from 1 to 50. New
  `lankir config add` and `lankir config remove` change the certificate
  folders (`certificateStores`) and token libraries (`tokenLibraries`).
- With `XDG_CONFIG_HOME` set, signature profiles and recent files are kept in
  `$XDG_CONFIG_HOME/lankir` next to `config.json`. The first run copies them
  there from `~/.config/lankir`, where 1.0 kept them; the originals stay.

## Fixed

- An OCSP answer of "unknown" (the certificate authority doesn't know the
  certificate) no longer reads as a revoked certificate; it reads as
  revocation not checked.
- A signature whose revocation service didn't answer is checked again the
  next time instead of being remembered for 10 minutes.
- `lankir pdf info` no longer pads the title, author, subject and creator
  with NUL bytes.
- `lankir cert list --source` help names the real sources: `User File`,
  `User Store`, `pkcs11` and `NSS Database`.
- `lankir sign verify --json` on a PDF without signatures prints `[]`, so the
  output is always JSON.

---

# Release v1.0.0

**Release Date:** 2026-11-14

---

## Highlights

- A new viewer built on pdf.js: tabs, thumbnails, outline, find, text
  selection, password-protected PDFs, forms and markup, saved back into the
  PDF.
- Signing in one panel next to the page, with the signature box placed
  directly on the page, smart cards and the DNIe, and RFC 3161 timestamps.
- Signature checks that say whether the document changed, whether the signer
  is trusted and whether the certificate was revoked, asking the certificate
  authority online.
- Page operations on the command line: rotate, delete, reorder, insert blank
  pages, extract, split, merge, encrypt, decrypt, metadata, optimize, validate.
- A redesigned interface on a small design system, with light and dark
  themes and a command palette.

## Added

- pdf.js viewer with one viewer per tab, fit width and fit page, zoom presets,
  Ctrl and mouse wheel zoom, page thumbnails and the document outline in one
  side panel (Pages, Outline, Info), resizable and remembered.
- Find with match case, whole words and highlight all.
- Opening password-protected PDFs.
- Filling in PDF forms; markup tools: highlight in five colours, text boxes,
  freehand drawing, images; undo, redo, delete.
- Save and Save as, with a prompt for unsaved changes on closing a tab or the
  window, and a check for files changed on disk since they were opened.
- Command palette (Ctrl K) listing every command, recent files, page numbers
  and zoom levels, with fuzzy search.
- Start page with recent files and their first-page thumbnails; removing a file
  from the recent list.
- Opening files from the command line (`lankir file.pdf`), from the file
  manager (Open with), by dropping them on the window, and into an already
  running window (single instance). New window (Ctrl Shift N).
- Sign panel docked beside the page: certificate and profile pickers, PIN
  field with retry on a wrong PIN, live signature box to move and resize,
  "Save signed copy as…". The last certificate and profile are remembered.
- Signing with password-protected `.p12` files, read when signing.
- RFC 3161 timestamps (PAdES B-T) from a configurable timestamp server, also
  `lankir sign pdf --tsa`.
- Signature profiles: a free-text location field, and the default position is
  optional; without one the box starts in the middle of the current page.
- Signature details in the Info panel: status and explanation, signing time
  and its source, timestamp, signer certificate, certificate chain and checks.
- Online revocation checking (OCSP and CRL) for trusted certificate chains,
  with a setting to turn it off.
- CLI commands `lankir pdf rotate`, `delete`, `reorder`, `insert-blank`,
  `extract`, `split`, `merge`, `encrypt`, `decrypt`, `meta`, `optimize` and
  `validate`.
- The app's version, in Settings › Advanced and with `lankir --version`.
- Settings: window tint, timestamp server, location lookup, revocation
  checking, configurable shortcuts including new window and the command
  palette.
- Certificate store backends per operating system (groundwork for Windows and
  macOS builds).

## Changed

- Moved from Wails v2 to Wails v3, on GTK 3 and WebKitGTK 4.1. The frontend is
  built with Vite and Tailwind 4.
- Redesigned interface: one header with tabs, floating page and zoom controls,
  one side panel, a preferences-style Settings dialog, and dialogs and errors
  in plain words.
- The version comes from the git tag and is stamped into the binary.
- The `.deb` and `.rpm` packages install the portable static binary.
- `lankir sign pdf` writes the signed file straight to the output path and
  refuses an output that is the input file. PINs and passwords typed at the
  terminal are no longer echoed.
- `lankir sign verify` prints the key algorithm and the revocation status, and
  checks revocation online when the setting is on (the default).
- New signatures are PAdES (SubFilter `ETSI.CAdES.detached`; it was
  `adbe.pkcs7.detached`). Signing with a `.p12` or `.pfx` file embeds the CA
  certificates in the file along with the signer's; NSS and PKCS#11 (smart
  cards, tokens) signatures embed only the signer's certificate.
- Signing an already-signed PDF adds an approval signature; an invisible
  signature on an unsigned PDF is a certification signature.
- New configurations open documents with the side panel closed.
- The default signed copy is `<name>_signed.pdf`, or `<name>_signed_2.pdf` and
  so on, never overwriting an existing file.

## Fixed

- `lankir pdf render` and `lankir pdf thumbnail` write real PNG files (they
  wrote base64 text).
- Unsigned signature fields are no longer reported as broken signatures.
- MuPDF metadata reads are serialized (MuPDF's context is not thread-safe).
- Links in a PDF can no longer navigate the app's window; web and mail links
  open in the browser.
- Wails' debug log no longer records binding arguments such as PINs.
- Custom shortcuts and the window tint are kept across restarts.
- Drag and drop of PDFs onto the window works on Linux.

## Removed

- The Sphinx documentation site and its Read the Docs configuration. The
  documentation is now Markdown in `docs/`: user guide, signing, command line,
  install and development.

## Breaking

- `lankir sign verify --json`: `signingHashAlgorithm` is now always empty (it
  used to hold the public key algorithm, which pdfsign doesn't report as a
  digest). The key algorithm is in the new `keyAlgorithm` field, e.g.
  `RSA 2048`.
- `lankir sign verify --json`: `signingTime` is now in UTC and comes from a
  valid trusted timestamp when the signature has one; the new
  `signingTimeSource` says which (`timestamp` or `signer`). New fields:
  `issuerTrusted`, `issuerName`, `issuerDN`, `certificateSerial`,
  `certificateValidFrom`, `certificateValidUntil`, `timestampTime`,
  `timestampStatus`, `revocationStatus`, `revocationCheck`, `chain`,
  `warnings`.
- `lankir sign verify` text output: the `Hash Algorithm:` line is now
  `Key Algorithm:`, and a `Revocation:` line was added.
- `config.json` follows `$XDG_CONFIG_HOME` when it is set (it was always
  `~/.config/lankir/config.json`). New keys: `tsaUrl`,
  `signatureLocationLookup`, `checkRevocationOnline`,
  `lastCertificateFingerprint`, `lastSignatureProfileId`. The default of
  `showLeftSidebar` is now `false`.
- The signature location is no longer looked up from ipinfo.io by default:
  profiles that show the location get it from ipinfo.io only when
  Settings › Signing › Look up my location is on. Otherwise they use the
  profile's Location field, so fill it in.
- Runtime dependency: WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`) instead of 4.0.
  Distributions without it, such as Ubuntu 20.04, are no longer supported.
- Desktop integration: the application id is now `com.lankir.Lankir` (Wayland
  app id and X11 `WM_CLASS`), the desktop file is `com.lankir.Lankir.desktop`
  (was `lankir.desktop`) and AppStream metadata is installed as
  `com.lankir.Lankir.metainfo.xml`. Desktop entries or default-app settings
  that name `lankir.desktop` need updating.
- With the new application id, WebKit keeps the app's web storage in
  `~/.local/share/com.lankir.Lankir` and `~/.cache/com.lankir.Lankir` instead
  of `~/.local/share/lankir` and `~/.cache/lankir`. The preferences kept only
  there go back to their defaults once: custom keyboard shortcuts and the
  window tint. Everything in `config.json` (theme, accent colour and the rest)
  is kept.
- All release files, the AppImage included, need glibc 2.35 or newer
  (Debian 12, Ubuntu 22.04, Fedora 39 and later; not Debian 11 or RHEL,
  AlmaLinux and Rocky Linux 8 and 9). Release assets are named
  `lankir-<version>-linux-x86_64`, `lankir-<version>-x86_64.AppImage`,
  `lankir_<version>_amd64.deb`, `lankir-<version>-1.x86_64.rpm` and
  `lankir-<version>-sha256sums.txt`; `wails.json` is gone and
  `lankir --version` reports the tag's version.
- The package repositories no longer get packages for Debian 11 (bullseye),
  Ubuntu 20.04 (focal) or RHEL, AlmaLinux and Rocky Linux 8 and 9; those
  systems stay on 0.1.1. The repositories now carry Debian 12, Ubuntu 22.04
  and 24.04, and Fedora 39 and 40.

## Known limitations

- Revocation lists published only over LDAP are not fetched, so certificates
  that name no OCSP server and only an LDAP CRL can't be checked online.
- pdfsign reports an OCSP "unknown" answer as revoked.
- The macOS certificate store is not implemented.
- Only Linux builds are released; Windows and macOS builds are not.
- Page operations are available on the command line only, not in the app.
- The Auto-save and Hardware acceleration settings are stored but have no
  effect yet.

See [docs/install.md](docs/install.md) to install.

**Full Changelog**: https://github.com/Matbe34/lankir/compare/v0.1.1...v1.0.0

---

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
