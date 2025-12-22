# Building Lankir

Build Lankir for development and distribution.

## Build Types

| Type | Command | Output | Use Case |
|------|---------|--------|----------|
| Development | `task dev` | Live reload | Development |
| Standard | `task build` | Binary | Testing |
| Static | `task build-static` | Portable binary | Distribution |
| AppImage | `task build-appimage` | `.AppImage` | Universal Linux |

## Development Build

```bash
task dev
# Or
wails dev
```

Features:
- Hot reload for frontend
- Debug logging enabled
- DevTools accessible (F12)
- Faster compilation

## Standard Build

```bash
task build
# Or
wails build
```

Output: `build/bin/lankir`

This build:
- Links dynamically to GTK3
- Requires GTK3 runtime on target
- Smaller binary size
- Faster build time

## Static Build

```bash
task build-static
```

Output: `build/bin/lankir_static`

This build:
- Links MuPDF statically
- Still requires GTK3 runtime
- More portable across distros
- Includes all PDF rendering code

### How Static Build Works

```bash
# scripts/build-static.sh sets CGO flags
export CGO_CFLAGS="-I${PWD}/go-fitz-include"
export CGO_LDFLAGS="-L${PWD}/go-fitz-libs \
    -lmupdf_linux_amd64 \
    -lmupdfthird_linux_amd64 \
    -lm"
```

## AppImage Build

```bash
task build-appimage
```

Output: `build/bin/lankir-0.1.0-x86_64.AppImage`

Features:
- Fully self-contained
- Includes GTK3 libraries
- Runs on any Linux distro
- No installation required

### AppImage Structure

```
AppDir/
├── AppRun                  # Entry script
├── lankir.desktop          # Desktop entry
├── usr/
│   └── bin/
│       └── lankir_static   # Application
└── [GTK3 libraries]        # Bundled libraries
```

## Build Requirements

### System Dependencies

```bash
# Debian/Ubuntu
sudo apt install \
    build-essential \
    pkg-config \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    libnss3-dev

# For AppImage
sudo apt install libfuse2
```

### MuPDF Libraries

The project includes pre-built static libraries:

```
go-fitz-include/       # Header files
go-fitz-libs/
├── libmupdf_linux_amd64.a
└── libmupdfthird_linux_amd64.a
```

Do not modify or delete these directories.

## Build Configuration

### Wails Configuration

```json
// wails.json
{
    "name": "Lankir",
    "outputfilename": "lankir",
    "frontend:install": "npm install",
    "frontend:build": "npm run build",
    "author": {
        "name": "Matbe34"
    }
}
```

### Taskfile

```yaml
# Taskfile.yml
version: '3'

tasks:
  build:
    cmds:
      - wails build

  build-static:
    cmds:
      - ./scripts/build-static.sh

  build-appimage:
    cmds:
      - ./scripts/build-appimage.sh
```

## Cross-Compilation

Currently, Lankir only supports Linux x86_64. Cross-compilation is complex due to CGO dependencies.

### Building for Different Architectures

For ARM64 or other architectures, you would need:
1. MuPDF static libraries compiled for target architecture
2. Cross-compilation toolchain
3. Target system libraries

## Optimization

### Binary Size

Standard build: ~50MB
Static build: ~60MB
AppImage: ~100MB (includes GTK3)

To reduce size:

```bash
# Strip debug symbols (done by default in release)
strip build/bin/lankir

# UPX compression (optional, may affect startup time)
upx --best build/bin/lankir
```

### Build Speed

```bash
# Parallel compilation
go build -p 8 ./...

# Skip frontend rebuild if unchanged
wails build --skipbindings
```

## Versioning

Version is defined in `wails.json`:

```json
{
    "info": {
        "productVersion": "0.1.0"
    }
}
```

To update version:
1. Edit `wails.json`
2. Update AppImage script if needed
3. Rebuild

## Release Checklist

1. **Update version** in `wails.json`
2. **Run tests**: `task test`
3. **Build AppImage**: `task build-appimage`
4. **Test AppImage** on clean system
5. **Create release** with changelog
6. **Upload** AppImage to releases

## Troubleshooting

### "go-fitz-libs not found"

Ensure you're building from the project root:
```bash
cd /path/to/lankir
task build-static
```

### CGO Linking Errors

```bash
# Check CGO is enabled
go env CGO_ENABLED  # Should be 1

# Verify library paths
ls -la go-fitz-libs/

# Check for missing system libraries
ldd build/bin/lankir | grep "not found"
```

### AppImage Won't Run

```bash
# Make executable
chmod +x lankir-*.AppImage

# Check FUSE
sudo apt install libfuse2

# Run with debug
./lankir-*.AppImage --appimage-help
```

### Frontend Not Updating

```bash
# Clean and rebuild
task clean
cd frontend && npm run build && cd ..
task build
```

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      
      - name: Install dependencies
        run: |
          sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev libnss3-dev
          go install github.com/wailsapp/wails/v2/cmd/wails@latest
      
      - name: Build
        run: task build-static
      
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: lankir
          path: build/bin/lankir_static
```

## Next Steps

- [Testing](testing.md) - Verify your build
- [Contributing](contributing.md) - Submit changes
