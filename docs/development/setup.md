# Development Setup

Set up your development environment for Lankir.

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.24+ | Backend development |
| Node.js | 18+ | Frontend tooling |
| Wails | 2.10+ | Build framework |
| Task | Latest | Task runner |

### System Dependencies

**Debian/Ubuntu:**
```bash
sudo apt install \
    build-essential \
    pkg-config \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    libnss3-dev \
    pcscd
```

**Fedora:**
```bash
sudo dnf install \
    @development-tools \
    gtk3-devel \
    webkit2gtk4.0-devel \
    nss-devel \
    pcsc-lite
```

**Arch:**
```bash
sudo pacman -S \
    base-devel \
    gtk3 \
    webkit2gtk \
    nss \
    pcsclite
```

## Installation

### 1. Install Go

```bash
# Download from go.dev or use package manager
wget https://go.dev/dl/go1.24.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.24.linux-amd64.tar.gz

# Add to PATH in ~/.bashrc
export PATH=$PATH:/usr/local/go/bin
export PATH=$PATH:$(go env GOPATH)/bin
```

### 2. Install Wails

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Verify installation
wails doctor
```

### 3. Install Task

```bash
# Using go
go install github.com/go-task/task/v3/cmd/task@latest

# Or via package manager
# Debian/Ubuntu
sudo snap install task --classic

# macOS
brew install go-task
```

### 4. Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Or via package manager
sudo apt install nodejs npm
```

## Clone and Setup

```bash
# Clone repository
git clone https://github.com/Matbe34/lankir.git
cd lankir

# Install frontend dependencies
cd frontend && npm install && cd ..

# Verify setup
task --list
```

## MuPDF Libraries

The project includes pre-built MuPDF static libraries:

```
go-fitz-include/   # MuPDF headers
go-fitz-libs/      # Static libraries
  ├── libmupdf_linux_amd64.a
  └── libmupdfthird_linux_amd64.a
```

These are required for PDF rendering. Do not delete them.

## Running Development Mode

```bash
# Start development server with hot reload
task dev

# Or directly
wails dev
```

This will:
1. Build the Go backend
2. Start the frontend dev server
3. Open the application window
4. Enable hot reload for frontend changes

### Development Features

- **Hot Reload**: Frontend changes apply instantly
- **DevTools**: Press F12 to open browser DevTools
- **Live Rebuild**: Go changes trigger recompilation
- **Verbose Logging**: Debug output in terminal

## Project Structure

```
lankir/
├── main.go              # Entry point
├── app.go               # Wails app wrapper
├── go.mod               # Go dependencies
├── Taskfile.yml         # Task definitions
├── wails.json           # Wails configuration
│
├── cmd/cli/             # CLI commands
│   ├── root.go
│   ├── pdf.go
│   ├── cert.go
│   ├── sign.go
│   └── config.go
│
├── internal/            # Business logic
│   ├── config/          # Configuration
│   ├── pdf/             # PDF operations
│   └── signature/       # Signing system
│       ├── pkcs11/      # Hardware tokens
│       ├── pkcs12/      # Certificate files
│       └── nss/         # Browser certs
│
├── frontend/            # Web UI
│   ├── src/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── js/          # JavaScript modules
│   ├── wailsjs/         # Generated bindings
│   └── package.json
│
├── go-fitz-include/     # MuPDF headers
├── go-fitz-libs/        # MuPDF libraries
└── docs/                # Documentation
```

## Available Tasks

```bash
# List all tasks
task --list

# Common tasks
task dev           # Development mode
task build         # Production build
task build-static  # Static build (portable)
task test          # Run tests
task test-coverage # Tests with coverage
task clean         # Clean build artifacts
task clean-all     # Deep clean
```

## IDE Setup

### VS Code

Recommended extensions:
- Go (golang.go)
- ESLint
- Tailwind CSS IntelliSense

Settings (`.vscode/settings.json`):
```json
{
    "go.useLanguageServer": true,
    "go.lintTool": "golangci-lint",
    "editor.formatOnSave": true,
    "[go]": {
        "editor.defaultFormatter": "golang.go"
    }
}
```

### GoLand

1. Open project as Go project
2. Enable Go Modules integration
3. Set GOROOT to your Go installation

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CGO_ENABLED` | Must be `1` for MuPDF |
| `CGO_CFLAGS` | Include paths for headers |
| `CGO_LDFLAGS` | Library paths for linking |

These are set automatically by the build scripts.

## Troubleshooting

### "wails: command not found"

```bash
# Ensure Go bin is in PATH
export PATH=$PATH:$(go env GOPATH)/bin

# Reinstall wails
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

### CGO Errors

```bash
# Verify CGO is enabled
go env CGO_ENABLED  # Should print 1

# Check GCC
gcc --version
```

### Missing GTK Libraries

```bash
# Check wails doctor
wails doctor

# Install missing dependencies
sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev
```

### NSS Build Errors

```bash
# Install NSS development files
sudo apt install libnss3-dev

# Verify pkg-config finds it
pkg-config --cflags --libs nss
```

## Next Steps

- [Building](building.md) - Build for distribution
- [Testing](testing.md) - Run and write tests
- [Contributing](contributing.md) - Contribution guidelines
