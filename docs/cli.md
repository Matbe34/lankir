# Command line

The `lankir` binary is both the desktop app and a command line tool. With no
arguments, or with only PDF paths, it opens the app. With a subcommand or a
flag first, it runs that command and exits.

```bash
lankir                      # open the app
lankir contract.pdf         # open the app with contract.pdf in a tab
lankir pdf info contract.pdf
```

If a file is named like a subcommand (for example a file called `pdf`), write
it as `./pdf` so it opens as a file.

Every command prints `--help`:

```bash
lankir sign pdf --help
```

Contents:

- [Global flags](#global-flags) and [output and exit status](#output-and-exit-status)
- [`lankir gui`](#lankir-gui)
- [`lankir pdf`](#lankir-pdf): information, rendering and page operations
- [`lankir cert`](#lankir-cert): certificates
- [`lankir sign`](#lankir-sign): signing, verifying, profiles
- [`lankir config`](#lankir-config): settings
- [`lankir completion`](#lankir-completion): shell completion
- [`lankir help`](#lankir-help)

## Global flags

These work with every command, except `--version`.

| Flag | Default | Meaning |
|------|---------|---------|
| `-v`, `--verbose` | off | Log at debug level, and show full file paths and certificate names in the log instead of shortened ones. |
| `--json` | off | Write the log as JSON lines. On commands that have their own `-j`, `--json` flag (most commands that print data), `--json` means JSON output instead; see below. |
| `-h`, `--help` | | Show help for the command. |
| `--version` | | Print the version and exit. Only on `lankir` itself (`lankir --version`), not after a subcommand. |

## Output and exit status

- Results go to standard output. Log lines go to standard error, at info level
  by default (`-v` adds debug lines).
- Commands that print data take `-j`, `--json` to print it as JSON. On those
  commands `--json` selects JSON output and the log stays in text form.
- A command exits with status 0 when it succeeds and 1 when it fails. The
  error is printed to standard error as `Error: <what failed>: <reason>`.
- `lankir sign verify` exits 0 when it could read the signatures, whatever their
  status. Read the status from its output.
- A missing or wrong subcommand under a group (for example `lankir pdf`) prints
  the group's help and exits 0.

## `lankir gui`

Opens the app with no document, the same as running `lankir` alone.

```bash
lankir gui
```

To open files, pass them directly instead: `lankir a.pdf b.pdf`. If the app is
already running, the files open as tabs in the running window.

## `lankir pdf`

Commands for PDF files. `info`, `pages`, `render` and `thumbnail` read the file
with MuPDF. The page operations (`rotate` to `validate`) use pdfcpu.

Page lists are 1-based and use commas and ranges: `1,3-5` means pages 1, 3, 4
and 5.

The commands that change a PDF write to the file given with `-o`, `--output`, or
overwrite the input with `--in-place`; one of the two is required, and they
can't be combined. The output is written to a temporary file first and moved
into place only when the operation succeeds. These commands rewrite the whole
file, so signatures in it no longer verify afterwards.

### `lankir pdf info`

```text
lankir pdf info <pdf-file> [flags]
```

Prints the title, author, subject, creator and page count.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON (`title`, `author`, `subject`, `creator`, `pageCount`, `filePath`). |

```bash
lankir pdf info contract.pdf
```

### `lankir pdf pages`

```text
lankir pdf pages <pdf-file> [flags]
```

Prints each page's width and height in points.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print a JSON list of `{page, width, height}`. |

```bash
lankir pdf pages contract.pdf --json
```

### `lankir pdf render`

```text
lankir pdf render <pdf-file> [flags]
```

Renders one page to a PNG file.

| Flag | Default | Meaning |
|------|---------|---------|
| `-p`, `--page` | `1` | Page to render. |
| `-d`, `--dpi` | `150` | Resolution in dots per inch. |
| `-o`, `--output` | `<name>_page<N>.png` in the current directory | Output PNG file. |

```bash
lankir pdf render contract.pdf --page 3 --dpi 300 -o page3.png
```

### `lankir pdf thumbnail`

```text
lankir pdf thumbnail <pdf-file> [flags]
```

Writes a PNG preview of the first page.

| Flag | Default | Meaning |
|------|---------|---------|
| `-w`, `--width` | `400` | Maximum width in pixels. |
| `-o`, `--output` | `<name>_thumbnail.png` in the current directory | Output PNG file. |

```bash
lankir pdf thumbnail contract.pdf -w 200 -o thumb.png
```

### `lankir pdf rotate`

```text
lankir pdf rotate <pdf-file> --degrees <90|180|270|-90> [flags]
```

Rotates pages clockwise.

| Flag | Default | Meaning |
|------|---------|---------|
| `--degrees` | required | `90`, `180`, `270` or `-90`. |
| `--pages` | all pages | Pages to rotate, e.g. `1,3-5`. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf rotate scan.pdf --degrees 90 --pages 2 --in-place
```

### `lankir pdf delete`

```text
lankir pdf delete <pdf-file> --pages <list> [flags]
```

Deletes pages.

| Flag | Default | Meaning |
|------|---------|---------|
| `--pages` | required | Pages to delete, e.g. `2,4-6`. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf delete report.pdf --pages 2,4-6 -o report-short.pdf
```

### `lankir pdf reorder`

```text
lankir pdf reorder <pdf-file> --order <list> [flags]
```

Rewrites the document with its pages in a new order. The order must name every
page once.

| Flag | Default | Meaning |
|------|---------|---------|
| `--order` | required | New page order, e.g. `3,1,2`. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf reorder slides.pdf --order 3,1,2 -o slides-reordered.pdf
```

### `lankir pdf insert-blank`

```text
lankir pdf insert-blank <pdf-file> --after <N> [flags]
```

Inserts one blank page after page N. `--after 0` inserts it at the front.

| Flag | Default | Meaning |
|------|---------|---------|
| `--after` | required | Insert after this page; `0` for the front. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf insert-blank notes.pdf --after 0 --in-place
```

### `lankir pdf extract`

```text
lankir pdf extract <pdf-file> --pages <list> -o <out.pdf> [flags]
```

Copies pages into a new PDF. The input is not changed.

| Flag | Default | Meaning |
|------|---------|---------|
| `--pages` | required | Pages to extract, e.g. `1,3-5`. |
| `-o`, `--output` | required | Output PDF file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf extract contract.pdf --pages 1-3 -o summary.pdf
```

### `lankir pdf split`

```text
lankir pdf split <pdf-file> (--ranges <groups> | --every <N>) [flags]
```

Splits a PDF into several files named `<name>_part1.pdf`, `<name>_part2.pdf`
and so on. Give exactly one of `--ranges` or `--every`. It refuses to overwrite
existing part files.

| Flag | Default | Meaning |
|------|---------|---------|
| `--ranges` | | Page groups separated by `;`, one file each, e.g. `"1-3;4-6;7-9"`. |
| `--every` | | Files of N pages each. |
| `--out-dir` | the input's folder | Folder for the parts; created if missing. |
| `-j`, `--json` | off | Print `{files: [...]}` as JSON. |

```bash
lankir pdf split book.pdf --every 10 --out-dir chapters
```

### `lankir pdf merge`

```text
lankir pdf merge <out.pdf> <in1.pdf> <in2.pdf> [...] [flags]
```

Joins two or more PDFs, in the order given, into the first file named. The
output may be one of the inputs.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf merge all.pdf cover.pdf body.pdf appendix.pdf
```

### `lankir pdf encrypt`

```text
lankir pdf encrypt <pdf-file> [flags]
```

Encrypts a PDF with AES-256. Pass `-` as a password to read it from standard
input (a terminal doesn't echo it), which keeps it out of the shell history.
Only one password can come from standard input.

Restrictions (printing only) apply only when the owner password differs from
the user password. With one password for both, anyone who can open the PDF has
full rights.

| Flag | Default | Meaning |
|------|---------|---------|
| `--user-password` | | Password needed to open the PDF. |
| `--owner-password` | the user password | Password that lifts the restrictions. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath}` as JSON. |

```bash
lankir pdf encrypt payslip.pdf --user-password - -o payslip-locked.pdf
```

### `lankir pdf decrypt`

```text
lankir pdf decrypt <pdf-file> --password <pw> [flags]
```

Removes password protection, given the user or owner password. `-` reads the
password from standard input.

| Flag | Default | Meaning |
|------|---------|---------|
| `--password` | required | User or owner password. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf decrypt payslip-locked.pdf --password - -o payslip.pdf
```

### `lankir pdf meta`

```text
lankir pdf meta <pdf-file> [--set key=value ...] [flags]
```

Without `--set`, prints the document information: title, author, subject,
keywords, creator and producer. With `--set`, changes entries and writes the
result; an empty value removes the entry. `-o` and `--in-place` need `--set`.

| Flag | Default | Meaning |
|------|---------|---------|
| `--set` | | `key=value`, repeatable. Keys: `title`, `author`, `subject`, `keywords`, `creator`, `producer`. |
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print the entries (or, with `--set`, `{filePath, pageCount}`) as JSON. |

```bash
lankir pdf meta report.pdf --set title="Annual report" --set author= --in-place
```

### `lankir pdf optimize`

```text
lankir pdf optimize <pdf-file> [flags]
```

Rewrites the file without redundant objects and with a compressed structure.

| Flag | Default | Meaning |
|------|---------|---------|
| `-o`, `--output` | | Output PDF file. |
| `--in-place` | off | Overwrite the input file. |
| `-j`, `--json` | off | Print `{filePath, pageCount}` as JSON. |

```bash
lankir pdf optimize scan.pdf -o scan-small.pdf
```

### `lankir pdf validate`

```text
lankir pdf validate <pdf-file> [flags]
```

Checks the file's structure. Prints `<file> is valid` and exits 0, or prints
the problem and exits 1.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print `{filePath, valid, error}` as JSON, also when the file is not valid. |

```bash
lankir pdf validate download.pdf
```

## `lankir cert`

Commands that list the certificates Lankir finds: certificate files in the
certificate folders, smart cards and tokens through the PKCS#11 libraries, and
the NSS database. See [Signing: certificates](signing.md#certificates) for
where it looks.

### `lankir cert list`

```text
lankir cert list [flags]
```

Lists the certificates found. The text output stops at 20 unless `--all` is
given; `--json` prints them all.

| Flag | Default | Meaning |
|------|---------|---------|
| `-s`, `--source` | all | Only certificates from one source: `"User File"` (PKCS#12 files), `"User Store"` (certificate files without a key), `pkcs11` (smart cards and tokens) or `"NSS Database"`. Not case sensitive. |
| `--search` | | Only certificates whose name, subject, issuer or serial number contains this text. |
| `--valid-only` | off | Only certificates that are within their validity dates. |
| `--all` | off | Show every certificate in the text output, not only the first 20. |
| `-j`, `--json` | off | Print JSON. |

```bash
lankir cert list --source pkcs11 --valid-only
```

### `lankir cert search`

```text
lankir cert search <query> [flags]
```

Lists the certificates whose name, subject, issuer or serial number contains
the query.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON. |

```bash
lankir cert search "GARCIA LOPEZ"
```

### `lankir cert info`

```text
lankir cert info <fingerprint> [flags]
```

Shows one certificate in full: subject, issuer, serial, validity, source, PIN
use, key usage and where it is stored. Take the fingerprint from
`lankir cert list`.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON. |

```bash
lankir cert info "$(lankir cert list --json | jq -r '.[0].fingerprint')"
```

## `lankir sign`

Commands for signing and verifying PDFs and for reading signature profiles.

### `lankir sign pdf`

```text
lankir sign pdf <input-pdf> <output-pdf> [flags]
```

Signs a PDF and writes the signed copy to `<output-pdf>`, which must be a
different file. Choose the certificate with one of `--cert-file`,
`--fingerprint` or `--name` (checked in that order).

If the certificate needs a PIN or password and `--pin` is not given, Lankir asks
for it on the terminal without echoing it; without a terminal it reads one line
from standard input.

The signature is visible by default, drawn with the built-in visible profile at
`--page`, `--x`, `--y`, `--width` and `--height` (points, from the bottom left
of the page). `--visible=false` makes an invisible signature. The command line
doesn't use the signature profiles you made in the app.

| Flag | Default | Meaning |
|------|---------|---------|
| `-f`, `--cert-file` | | A `.p12` or `.pfx` file. It must be in one of the certificate folders (see `lankir config get certificateStores`). |
| `--fingerprint` | | Certificate fingerprint, from `lankir cert list`. |
| `-n`, `--name` | | Part of the certificate's name. If several match, the command lists them and exits 1. |
| `--pin` | | PIN of the card or token, or password of the file. |
| `--visible` | `true` | Draw the signature on the page. |
| `--page` | `1` | Page for a visible signature. |
| `--x` | `100` | Left edge of the box, in points. |
| `--y` | `100` | Bottom edge of the box, in points. |
| `--width` | `200` | Box width, in points. |
| `--height` | `100` | Box height, in points. |
| `--tsa` | the `tsaUrl` setting | RFC 3161 timestamp server URL. An empty value (`--tsa ""`) signs without a timestamp. |

```bash
lankir sign pdf contract.pdf contract_signed.pdf --name "GARCIA LOPEZ" --visible=false
```

### `lankir sign verify`

```text
lankir sign verify <pdf-file> [flags]
```

Checks every signature in a PDF and prints, for each: signer, signing time,
signature algorithm, key algorithm, whether the document is unchanged
(`Valid`), whether the certificate is trusted (`Cert Valid`), the revocation
status and how it was checked, and the reason, location and contact if the
signature has them.

When the `checkRevocationOnline` setting is on (the default), this contacts the
OCSP and CRL servers named in trusted certificates; see
[Signing: revocation](signing.md#online-revocation-checking). A PDF with no
signatures prints `No signatures found in PDF`, or `[]` with `--json`.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print a JSON list with every field, such as `isValid`, `certificateValid`, `issuerTrusted`, `keyAlgorithm`, `revocationStatus` (`good`, `revoked`, `revoked_later`, `unavailable`, `not_checked`), `revocationCheck`, `timestampStatus`, `chain` and `warnings`. |
| `--offline` | off | Use only the revocation data embedded in the PDF and contact no server, whatever the `checkRevocationOnline` setting. |

```bash
lankir sign verify contract_signed.pdf --json
```

### `lankir sign profile-list`

```text
lankir sign profile-list [flags]
```

Lists the signature profiles made in the app, with their position and
appearance for visible ones.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON. |

```bash
lankir sign profile-list
```

### `lankir sign profile-info`

```text
lankir sign profile-info <profile-id> [flags]
```

Shows one profile in full. The id is the UUID that `profile-list` prints; the
built-in invisible profile is `00000000-0000-0000-0000-000000000001` and the
built-in visible one `00000000-0000-0000-0000-000000000002`.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON. |

```bash
lankir sign profile-info 00000000-0000-0000-0000-000000000002
```

## `lankir config`

Commands that read and change `config.json`, the settings file the app also
uses (see [Install: files](install.md#files-lankir-keeps)). Key names are not
case sensitive. Change settings while the app is closed: the app saves the
settings it has open when you press **Save** in Settings.

| Key | Type | Meaning |
|-----|------|---------|
| `theme` | text | `light`, `dark` or `auto` (same as the system). |
| `accentColor` | text | Accent colour, `#rrggbb`. |
| `defaultZoom` | number | Zoom for newly opened documents, in percent, from 10 to 400. |
| `showLeftSidebar`, `showRightSidebar` | true or false | Whether a new document opens with the side panel on Pages, or on Info. |
| `defaultViewMode` | text | Not used by the app. |
| `recentFilesLength` | number | How many recent files to list, from 1 to 50. |
| `autosaveInterval` | number | Ignored; there is no auto-save. Kept so older files still load. |
| `certificateStores` | list | Folders searched for certificate files. Change with `config add` and `config remove`. |
| `tokenLibraries` | list | PKCS#11 libraries for smart cards and tokens. Change with `config add` and `config remove`. |
| `tsaUrl` | text | Timestamp server URL; empty for none. |
| `signatureLocationLookup` | true or false | When a profile shows the location, look it up from your IP address (see [Signing: privacy](signing.md#privacy)). |
| `checkRevocationOnline` | true or false | Ask certificate authorities online whether a certificate was revoked. |
| `lastCertificateFingerprint`, `lastSignatureProfileId` | text | The certificate and profile used last. Saved by the app when you sign; `config set` can't change them. |
| `debugMode` | true or false | Debug logging. |
| `hardwareAccel` | true or false | Hardware acceleration in the app's web view; applies the next time the app starts. |

### `lankir config get`

```text
lankir config get [key] [flags]
```

Without a key, prints every setting as `key: value`, a list as its key and then
one item per line; with `--json`, prints the whole file. With a key, prints
that setting.

| Flag | Default | Meaning |
|------|---------|---------|
| `-j`, `--json` | off | Print JSON. |

```bash
lankir config get tokenLibraries
```

### `lankir config set`

```text
lankir config set <key> <value>
```

Changes one setting that is text, a number, or `true` or `false` (also `1`
and `0`). It takes only the values the app's Settings would store, listed in the
table above, and exits with an error for any other. Lists are changed with [`config add`](#lankir-config-add) and
[`config remove`](#lankir-config-remove).

```bash
lankir config set theme light
lankir config set checkRevocationOnline false
lankir config set tsaUrl http://timestamp.digicert.com
```

### `lankir config add`

```text
lankir config add <key> <path>
```

Adds a path to `certificateStores` or `tokenLibraries`, checked the way
Settings checks it: a certificate folder must be in your home folder or a
system certificate folder, a library must end in `.so`, `.dylib` or `.dll`. A
relative path is made absolute.

```bash
lankir config add certificateStores ~/certificates
lankir config add tokenLibraries /usr/lib/x86_64-linux-gnu/opensc-pkcs11.so
```

### `lankir config remove`

```text
lankir config remove <key> <path>
```

Removes a path from `certificateStores` or `tokenLibraries`. If you remove every
certificate folder or every library, the defaults come back the next time
the settings are loaded.

```bash
lankir config remove certificateStores ~/certificates
```

### `lankir config reset`

```text
lankir config reset
```

Puts every setting in `config.json` back to its default. Signature profiles and
recent files are kept.

```bash
lankir config reset
```

## `lankir completion`

Prints a shell completion script. Each shell has its own subcommand; run it
with `--help` for where to put the script.

### `lankir completion bash`

```text
lankir completion bash [flags]
```

Needs the `bash-completion` package.

| Flag | Default | Meaning |
|------|---------|---------|
| `--no-descriptions` | off | Complete names only, without their descriptions. |

```bash
lankir completion bash > ~/.local/share/bash-completion/completions/lankir
```

### `lankir completion zsh`

```text
lankir completion zsh [flags]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--no-descriptions` | off | Complete names only, without their descriptions. |

```bash
lankir completion zsh > "${fpath[1]}/_lankir"
```

### `lankir completion fish`

```text
lankir completion fish [flags]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--no-descriptions` | off | Complete names only, without their descriptions. |

```bash
lankir completion fish > ~/.config/fish/completions/lankir.fish
```

### `lankir completion powershell`

```text
lankir completion powershell [flags]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--no-descriptions` | off | Complete names only, without their descriptions. |

```bash
lankir completion powershell > lankir.ps1
```

## `lankir help`

```text
lankir help [command]
```

Shows the help for a command, the same as `--help`: `lankir help sign pdf`.
