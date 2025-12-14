#!/bin/bash
set -e

echo "Building PDF App (Portable Binary)..."

# Build frontend first
echo "Building frontend..."
cd frontend
./build.sh
cd ..

# Set CGO flags for mostly-static linking
# We link MuPDF statically but allow minimal system libs (glibc, NSS) dynamically
export CGO_ENABLED=1
export CGO_CFLAGS="-I/opt/go/pkg/mod/github.com/gen2brain/go-fitz@v1.24.15/include"
export CGO_LDFLAGS="-L/opt/go/pkg/mod/github.com/gen2brain/go-fitz@v1.24.15/libs -lmupdf_linux_amd64 -lmupdfthird_linux_amd64"

# Build binary with Go
# This creates a portable binary that only depends on common system libraries
echo "Building portable Go binary..."
go build \
  -tags "netgo" \
  -ldflags='-s -w' \
  -o pdf-app-static \
  .

# Verify the binary
echo ""
echo "Build complete! Binary: pdf-app-static"
echo "Binary size: $(du -h pdf-app-static | cut -f1)"
echo ""

# Check dependencies
echo "Checking binary dependencies..."
echo "Dynamic libraries required:"
ldd pdf-app-static | sort | uniq

# Count non-system dependencies
NON_SYSTEM_DEPS=$(ldd pdf-app-static | grep -v -E '(linux-vdso|ld-linux|libc\.so|libm\.so|libpthread|libresolv|libdl|librt|libnss|libnspr)' | wc -l)

echo ""
if [ "$NON_SYSTEM_DEPS" -eq 0 ]; then
    echo "✓ Binary only depends on standard system libraries (glibc, NSS)"
    echo "✓ This binary should work on most modern Linux systems"
else
    echo "⚠ Binary has $NON_SYSTEM_DEPS non-standard dependencies"
fi

echo ""
echo "To deploy on another system:"
echo "1. Copy pdf-app-static to target system"
echo "2. Ensure target has standard libraries: glibc, libnss3, libnspr4"
echo "   (These are present on virtually all Linux distributions)"
echo ""
echo "Note: The binary includes MuPDF, all Go code, and frontend assets embedded."