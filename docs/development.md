# Development

How to build, test and release Lankir, and how the code is laid out.

## Prerequisites

- **Go**: the version in `go.mod` (`go` and `toolchain` lines).
- **Node.js**: the version in `frontend/.nvmrc` (`nvm use` in `frontend/`).
  The frontend tests need Node 22 or later.
- **Task** (`go install github.com/go-task/task/v3/cmd/task@latest`): the
  project's commands are in `Taskfile.yml`.
- **System libraries**: GTK 3, WebKitGTK 4.1 and NSS headers, a C compiler and
  `pkg-config`:

  ```bash
  sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libnss3-dev   # Debian, Ubuntu
  sudo dnf install gcc pkgconf gtk3-devel webkit2gtk4.1-devel nss-devel                        # Fedora
  ```

  `task install-deps` installs only `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`
  and `libnss3-dev` with `apt`; the compiler and `pkg-config` come from the
  first line.
- **MuPDF headers and libraries** for `go-fitz`, linked from the Go module
  cache into the repository root (both names are gitignored):

  ```bash
  ln -s "$(go list -m -f '{{.Dir}}' github.com/gen2brain/go-fitz)/include" go-fitz-include
  ln -s "$(go list -m -f '{{.Dir}}' github.com/gen2brain/go-fitz)/libs" go-fitz-libs
  ```

- **Wails v3 CLI**, only to regenerate the frontend bindings. Install the same
  version as the `github.com/wailsapp/wails/v3` line in `go.mod`:

  ```bash
  go install -tags gtk3 github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
  ```

Go commands need the `gtk3` build tag: Lankir uses Wails' GTK 3 and
WebKitGTK 4.1 backend on Linux.

## Commands

`task --list` shows them all. The main ones:

| Command | What it does |
|---------|--------------|
| `task dev` | Starts the Vite dev server and runs the app against it. Frontend changes reload; restart for Go changes. |
| `task build` | Builds the frontend and a production binary at `build/bin/lankir`. |
| `task build-static` | Builds the portable `build/bin/lankir_static`, with MuPDF linked in. |
| `task appimage` | Builds the AppImage. |
| `task build-deb`, `task build-rpm` | Build the `.deb` and `.rpm` packages (needs `nfpm`). |
| `task build-packages` | All of the above. |
| `task test` | Go tests and frontend tests. |
| `task test-backend`, `task test-frontend` | One of the two. |
| `task test-coverage` | Coverage reports for both. |
| `task lint` | `golangci-lint` (v2) with the `gtk3` tag. |
| `task vet-cross` | `go vet` for Linux, Windows and macOS, to catch build-tag mistakes. |
| `task bindings` | Regenerates `frontend/bindings/` from the Go services. |
| `task frontend` | Builds only the frontend into `frontend/dist/`. |
| `task clean` | Removes build output. |

Builds take the version from the `VERSION` environment variable, or from
`git describe --tags` when it isn't set, and stamp it into the binary
(`lankir --version`).

## Architecture

One binary is both the app and the command line tool. `main.go` looks at the
arguments: none, or only file paths, start the app with those files; a
subcommand or a flag goes to the Cobra commands in `cmd/cli/`.

```text
main.go, app.go        start-up, window, single instance, file drops, close handling
cmd/cli/               Cobra commands (lankir pdf|cert|sign|config|gui)
internal/config/       config.json
internal/pdf/          open/save documents for the viewer, recent files, MuPDF rendering for the CLI
internal/pdfops/       page operations on files (pdfcpu)
internal/signature/    certificates, profiles, signing, verification
frontend/              the UI: Vite, pdf.js, plain ES modules
```

**Go services on Wails v3.** `main.go` registers five services with
`application.New`: `App`, `PDFService`, `RecentFilesService`,
`SignatureService` and `config.Service`. Their exported methods are callable
from JavaScript through the generated bindings in `frontend/bindings/`, which
`frontend/src/js/backend.js` re-exports. Wails calls a service's
`ServiceStartup` method, if it has one, when the app starts.

**Viewer.** Documents are drawn by pdf.js in the web view, not by Go. Opening
a file registers it with `PDFService`, which serves its bytes at `/doc/<id>`
through the Wails asset server; pdf.js loads from that URL. Saving sends the
bytes pdf.js produces (with form values and annotations) back to `/doc/<id>`
with a `PUT` on Linux, and through a binding on other systems. The Go side
writes to a temporary file and renames it, and refuses to overwrite a file that
changed on disk since it was opened unless told to.

**MuPDF** (through `go-fitz`) is used only by the command line's `pdf info`,
`pdf pages`, `pdf render` and `pdf thumbnail`. The page operations use pdfcpu.

**Signatures** (`internal/signature/`). `ListCertificates` gathers
certificates from every backend and removes duplicates by SHA-256
fingerprint:

- `pkcs12/`: `.p12`/`.pfx` files in the configured certificate folders.
- `pkcs11/`: smart cards and tokens through the configured PKCS#11 libraries
  (`miekg/pkcs11`).
- `nss/`: the user's NSS database (`~/.pki/nssdb`), Linux only; a stub on
  other systems.
- `certstore/`: the operating system's store, chosen per OS
  (`certificates_<os>.go`, `signing_<os>.go`); the macOS store is not
  implemented.

Signing and verification use `digitorus/pdfsign`. `verification.go` adds the
trust, timestamp and revocation interpretation the UI and `sign verify` show;
it goes online for revocation only for trusted chains, and only to the hosts
those certificates name. Profiles are stored by `profile.go`, one JSON file per
profile under `~/.config/lankir/signature_profiles/`.

## Frontend

- **Build**: Vite (`frontend/vite.config.js`). `npm run build` writes
  `frontend/dist/`, which `main.go` embeds, so build the frontend before
  `go build`. (`go test` only needs the directory, which is in the
  repository.) pdf.js' runtime assets (cmaps, standard fonts,
  wasm decoders) are copied to `dist/pdfjs/`.
- **Code**: plain ES modules in `frontend/src/js/`, one per feature. `app.js`
  starts everything and routes keyboard shortcuts. Shared state is in
  `state.js`.
- **Styles**: Tailwind 4 on top of a small design system. Every colour, size,
  radius and duration is a token in `frontend/src/styles/tokens.css`; a theme
  only overrides the colour roles (light in `:root`, dark in
  `[data-theme="dark"]`). Components use the primitives in
  `styles/components.css` (`.btn`, `.icon-btn`, `.menu`, `.input`, …);
  Tailwind utilities are only for layout.
- **Icons**: Lucide, imported one by one in `frontend/src/js/icons.js`.
  Markup uses `<i data-icon="name"></i>`; code that builds HTML strings uses
  `iconSvg(name)`. Add new icons to the imports there.
- **Drift rule**: don't add raw colours, one-off font sizes, radii or
  arbitrary Tailwind values (`p-[13px]`). Use a token, or add one to
  `tokens.css` when the design really needs a new value.

## Tests

```bash
go test -tags gtk3 ./...                              # Go, all packages
go test -tags gtk3 -run TestName ./internal/signature/ # one test
cd frontend && npm test                               # Vitest (happy-dom)
```

- Go tests use the standard `testing` package. Test data is in
  `internal/*/testdata/`; signing tests use fixed certificate files there.
- CLI tests in `cmd/cli/` run the commands in-process with a temporary
  `HOME`, so they never touch your settings.
- `cmd/cli/docs_test.go` fails when a command or flag is missing from
  [cli.md](cli.md). Document new commands there.
- Frontend tests are in `frontend/tests/`.

### Preview harness

The frontend runs in a normal browser with a mocked backend (no Go, no
Wails):

```bash
cd frontend
npm run preview:mock        # http://127.0.0.1:9317/?scene=viewer
```

`PREVIEW_PORT` changes the port. `?scene=<name>` drives the real UI into one
state with fixed data: two fixture PDFs, invented certificates and
signatures. The scenes are listed in `frontend/preview/scenes.js`, for example
`welcome`, `viewer`, `panels`, `annotate`, `sign`, `settings`,
`certificates`, `properties`, `signature-more`, `palette` and `tabs`. When a
scene is ready the page sets `html[data-scene-ready="1"]`, so a screenshot
tool can wait for it; `window.__PREVIEW_THEME = 'light'` before load picks the
light theme. The screenshots in `docs/images/` come from these scenes: captured
at 1440×900 and resized to 1280×800.

## Bindings

After changing the exported methods or types of a bound Go service, run:

```bash
task bindings
```

It runs `wails3 generate bindings` with the `gtk3` tag and rewrites
`frontend/bindings/`. Don't edit those files by hand. Commit them with the Go
change.

## Release process

The version is the git tag (`v1.0.0`); there is no version to edit in the
source.

1. Write the changelog section first: the first heading of `CHANGELOG.md` must
   name the version (`# Release v1.0.0`). Leave its date as
   `**Release Date:** TBD` to have the release script fill in the day you run
   it, or write the date yourself. Commit it to `master`.
2. On a clean `master` that matches `origin/master`, run
   `task release -- <version>` (or `scripts/release.sh <version>`). It checks
   the changelog heading, sets the version in `frontend/package.json`, replaces
   a `TBD` release date in the first changelog section with today's date,
   commits `chore: release v<version>` and creates an annotated tag. If the
   commit or the tag fails, it resets `master` to where it was, removing its
   changes. It prints the `git push` commands and doesn't push; push
   `master` and the tag yourself.
3. The tag starts the Release workflow in `.github/workflows/`. It runs the
   tests, then builds the static binary, the AppImage, the `.deb` and `.rpm`
   packages and a checksums file, all named with the tag's version, and
   publishes them as a GitHub release. A release candidate (a version with a
   `-`, such as `1.0.0-rc1`) is published as a GitHub prerelease and is not
   uploaded to the package repositories. For other versions it then uploads
   the `.deb` to the Cloudsmith repository `matbe34/lankir` for Debian
   bookworm and Ubuntu jammy and noble, and the `.rpm` for Fedora 39 and 40
   (see
   [Install: package repositories](install.md#package-repositories)). That
   step needs the repository secret `CLOUDSMITH_API_KEY`; without it the step
   is skipped and the GitHub release is still made.

To try the pipeline without publishing, run the Release workflow by hand
(**Actions › Release › Run workflow**) with the dry run option on: it builds
every artifact and uploads them to the workflow run, and publishes nothing.
