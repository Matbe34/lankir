#!/bin/bash
set -e

VERSION=$(./scripts/version.sh)

echo "============================================"
echo "Building Lankir ${VERSION} (Portable Binary)"
echo "============================================"
echo ""

# Build frontend first
echo "Step 1: Building frontend..."
(cd frontend && npm ci && npm run build)
echo "✓ Frontend built"
echo ""

# Set CGO flags for portable linking with MuPDF
echo "Step 2: Configuring portable build..."
export CGO_ENABLED=1

# Use the local MuPDF libraries from go-fitz-libs
export CGO_CFLAGS="-I${PWD}/go-fitz-include"
export CGO_LDFLAGS="-L${PWD}/go-fitz-libs -lmupdf_linux_amd64 -lmupdfthird_linux_amd64 -lm"

# Strip symbols and use trimpath for smaller, reproducible builds
echo "Step 3: Building application binary..."
mkdir -p build/bin
go build \
  -tags gtk3,production \
  -ldflags="-s -w -X github.com/Matbe34/lankir/internal/version.Version=${VERSION}" \
  -trimpath \
  -o build/bin/lankir_static .

echo ""
echo "============================================"
echo "Build Complete!"
echo "============================================"

# Check what was built
BINARY_PATH="build/bin/lankir_static"
if [ ! -f "$BINARY_PATH" ]; then
    BINARY_PATH="build/bin/lankir"
fi

if [ ! -f "$BINARY_PATH" ]; then
    echo "⚠ Could not find built binary in build/bin/"
    ls -la build/bin/ 2>/dev/null || echo "build/bin/ directory not found"
    exit 1
fi

echo ""
echo "Binary location: $BINARY_PATH"
echo "Binary size: $(du -h $BINARY_PATH | cut -f1)"
echo ""

# Check dependencies
echo "Checking binary dependencies..."
echo "================================"
ldd "$BINARY_PATH" 2>/dev/null | sort || echo "(could not analyze dependencies)"
echo "================================"
echo ""

# Count dependencies (excluding linux-vdso and ld-linux)
DEPS=$(ldd "$BINARY_PATH" 2>/dev/null | grep "=>" | wc -l || echo "0")
SYSTEM_DEPS=$(ldd "$BINARY_PATH" 2>/dev/null | grep -E "libc\.so|libm\.so|libpthread|libdl|librt|libnss|libnspr|libglib|libgtk|libgdk|libcairo|libwebkit" | wc -l || echo "0")

echo "Total dynamic dependencies: $DEPS"
echo "System library dependencies: $SYSTEM_DEPS"

if [ "$DEPS" -le 30 ]; then
    echo "✓ Reasonable number of dependencies for a GUI app"
else
    echo "⚠ Binary has many dependencies: $DEPS"
fi

echo ""
echo "============================================"
echo "Deployment Instructions:"
echo "============================================"
echo "This binary is portable across Linux systems with:"
echo ""
echo "Requirements on target system:"
echo "  • Linux x86_64 (kernel 3.2+)"
echo "  • GTK3 and WebKit2GTK (standard on most desktop distros)"
echo "  • NSS libraries (for certificate operations)"
echo "  • Standard glibc 2.17+"
echo ""
echo "Installation on target system:"
echo "  Ubuntu/Debian:"
echo "    sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libnss3"
echo ""
echo "  Fedora/RHEL:"
echo "    sudo dnf install gtk3 webkit2gtk4.1 nss"
echo ""
echo "  Arch:"
echo "    sudo pacman -S gtk3 webkit2gtk-4.1 nss"
echo ""
echo "Deploy the binary:"
echo "  1. Copy: scp $BINARY_PATH user@target:/usr/local/bin/lankir"
echo "  2. Make executable: chmod +x /usr/local/bin/lankir"
echo "  3. Run: lankir"
echo ""
echo "Note: All assets, frontend code, and MuPDF library are"
echo "      embedded in the binary - no additional files needed!"
echo "============================================"