# Install

Lankir runs on 64-bit x86 Linux. Each release on the
[releases page](https://github.com/Matbe34/lankir/releases) has:

| File | What it is |
|------|------------|
| `lankir-<version>-x86_64.AppImage` | One file with Lankir and the libraries it needs. Runs on most distributions without installing anything. |
| `lankir_<version>_amd64.deb` | Package for Debian, Ubuntu and derivatives. |
| `lankir-<version>-1.x86_64.rpm` | Package for Fedora. |
| `lankir-<version>-linux-x86_64` | The program alone, for systems that already have GTK 3 and WebKitGTK. |
| `lankir-<version>-sha256sums.txt` | SHA-256 sums of the files above. |

Every file, the AppImage included, needs glibc 2.35 or later: Debian 12,
Ubuntu 22.04, Fedora 39 and later. Debian 11 and RHEL, AlmaLinux and Rocky
Linux 9 are too old.

The `.deb` and `.rpm` packages contain the same standalone program,
installed as `/usr/bin/lankir`, plus a menu entry and an icon. MuPDF is built
into the program, so it doesn't need to be installed. On openSUSE, use the
AppImage or the standalone program.

To check a download against the release's checksums:

```bash
sha256sum --ignore-missing -c lankir-<version>-sha256sums.txt
```

After installing, `lankir --version` prints the version.

## AppImage

```bash
chmod +x lankir-*.AppImage
./lankir-*.AppImage
```

The AppImage doesn't add itself to the applications menu. See
[Open PDFs with Lankir](#open-pdfs-with-lankir) to add it.

## Debian and Ubuntu (.deb)

```bash
sudo apt install ./lankir_*_amd64.deb
```

`apt` installs the runtime libraries the package depends on: GTK 3,
WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`) and NSS (`libnss3`). WebKitGTK 4.1 is in
Debian 12, Ubuntu 22.04 and later.

## Fedora (.rpm)

```bash
sudo dnf install ./lankir-*.x86_64.rpm
```

If the package manager doesn't pull them in, install GTK 3, WebKitGTK 4.1 and
NSS yourself, on Fedora with:

```bash
sudo dnf install gtk3 webkit2gtk4.1 nss
```

## Package repositories

Each release's `.deb` and `.rpm` are also published to package repositories on
Cloudsmith, so `apt` and `dnf` install updates along with the rest of the
system. New releases go to exactly these distributions: Debian 12 (bookworm)
and 13 (trixie), Ubuntu 22.04 (jammy), 24.04 (noble) and 26.04 (resolute),
Linux Mint 21 and 22 and LMDE 6, and Fedora 39, 40, 43, 44 and 45. Release
candidates are not published there. Older distributions that had 0.1.x
packages (Debian 11, Ubuntu 20.04, RHEL/AlmaLinux/Rocky 8 and 9) keep 0.1.1,
because 1.0 needs glibc 2.35. On other distributions and newer versions,
download the
`.deb` or `.rpm` from the
[releases page](https://github.com/Matbe34/lankir/releases) instead.

Debian, Ubuntu and Linux Mint:

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/matbe34/lankir/setup.deb.sh' | sudo -E bash
sudo apt update
sudo apt install lankir
```

On another system based on Ubuntu or Debian, or one the script doesn't
recognise (such as LMDE 7), name the Ubuntu or Debian release it is built on:

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/matbe34/lankir/setup.deb.sh' | sudo -E distro=ubuntu codename=noble bash
```

(`codename=jammy` for Ubuntu 22.04 bases, `distro=debian codename=trixie` for
Debian 13 bases.)

Fedora:

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/matbe34/lankir/setup.rpm.sh' | sudo -E bash
sudo dnf install lankir
```

On Fedora 44 and later, the repository file the setup script writes points at a
CA bundle (`/etc/pki/tls/certs/ca-bundle.crt`) that these releases no longer
have, so `dnf` can't reach the repository. Remove that line so `dnf` uses the
system's trusted certificates, then install:

```bash
sudo sed -i '/^sslcacert=/d' /etc/yum.repos.d/matbe34-lankir.repo
sudo dnf install lankir
```

## Standalone program

`lankir-<version>-linux-x86_64` needs GTK 3, WebKitGTK 4.1 and NSS from the system:

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libnss3   # Debian, Ubuntu
sudo dnf install gtk3 webkit2gtk4.1 nss                   # Fedora
sudo pacman -S gtk3 webkit2gtk-4.1 nss                    # Arch
```

Then put it on your `PATH`:

```bash
install -Dm755 lankir-*-linux-x86_64 ~/.local/bin/lankir
lankir
```

## Smart cards and the DNIe

To sign with a smart card, a USB token or the DNIe, also install the card
reader service and OpenSC (`pcscd` and `opensc` on Debian and Ubuntu,
`pcsc-lite` and `opensc` on Fedora). See [Signing](signing.md#smart-cards-and-tokens-pkcs11).

## Open PDFs with Lankir

The `.deb` and `.rpm` packages add Lankir to the applications menu and register
it for PDF files, so it shows up under **Open with** in the file manager.

To make it the default PDF app, choose it in your desktop's default
applications settings, or run this with the desktop file the package
installed (`com.lankir.Lankir.desktop`):

```bash
xdg-mime default com.lankir.Lankir.desktop application/pdf
```

For the AppImage or the standalone program, add a desktop file yourself. The
icon is `assets/lankir.png` in the source; download it next to the program:

```bash
curl -L --create-dirs -o ~/Applications/lankir.png https://raw.githubusercontent.com/Matbe34/lankir/master/assets/lankir.png
```

Save this as `~/.local/share/applications/com.lankir.Lankir.desktop`, with
`Exec` and `Icon` pointing to where you put the files:

```ini
[Desktop Entry]
Type=Application
Name=Lankir
Comment=PDF viewer and signer
Exec=/home/you/Applications/lankir.AppImage %F
Icon=/home/you/Applications/lankir.png
Terminal=false
Categories=Office;
StartupWMClass=com.lankir.Lankir
MimeType=application/pdf;
```

Then:

```bash
update-desktop-database ~/.local/share/applications
xdg-mime default com.lankir.Lankir.desktop application/pdf
```

## Uninstall

```bash
sudo apt remove lankir      # .deb
sudo dnf remove lankir      # .rpm
```

For the AppImage or the standalone program, delete the file and any desktop
file you added.

Removing the program keeps your settings. To remove them too, delete
`~/.config/lankir`, and `$XDG_CONFIG_HOME/lankir` if you set `XDG_CONFIG_HOME`
(see below), the web view's storage in `~/.local/share/com.lankir.Lankir`
and `~/.cache/com.lankir.Lankir`, and `~/.cache/lankir` (under
`$XDG_DATA_HOME` and `$XDG_CACHE_HOME` if you set them). After upgrading from
0.1.x you can also delete the old `~/.local/share/lankir` (likewise under
`$XDG_DATA_HOME` if set).

## Files Lankir keeps

| Path | Contents |
|------|----------|
| `~/.config/lankir/config.json` | Settings: theme, zoom, certificate folders and libraries, timestamp server, revocation and location settings, the last certificate and profile used. |
| `~/.config/lankir/signature_profiles/` | One JSON file per signature profile. |
| `~/.config/lankir/recent.json` | Recent files. |
| `~/.local/share/com.lankir.Lankir/` | The app's web view storage: keyboard shortcuts, the window tint and the side panel width. |
| `~/.cache/com.lankir.Lankir/` | The web view's cache. |
| `~/.cache/lankir/work/` | Unsaved page changes, readable only by you; removed when you save, close the tab or quit, and at the next start after a crash. |

If `XDG_CONFIG_HOME` is set, the three `~/.config/lankir` entries are in
`$XDG_CONFIG_HOME/lankir/` instead. Lankir 1.0 kept the profiles and recent
files in `~/.config/lankir` even then; 1.0.1 copies them to
`$XDG_CONFIG_HOME/lankir/` the first time it runs, when that folder has none
yet, and leaves the old copies in place. The two web view folders and
`~/.cache/lankir` follow `XDG_DATA_HOME` and `XDG_CACHE_HOME` when those are
set.

`lankir config` reads and changes `config.json` from the command line
([Command line](cli.md#lankir-config)).
