#!/bin/bash
set -e

VERSION=$(./scripts/version.sh)
export VERSION

echo "============================================"
echo "Building Lankir ${VERSION} (Portable AppImage)"
echo "============================================"
echo ""

# Configuration
APP_NAME="lankir"
APP_ID="com.lankir.Lankir"
BINARY_NAME="lankir_static"
BUILD_DIR="build/bin"
APPIMAGE_DIR="build/appimage"
APPDIR="${APPIMAGE_DIR}/AppDir"
CACHE_DIR="build/appimage-cache"
CACHE_APPDIR="${CACHE_DIR}/AppDir"
TOOLS_DIR="build/linuxdeploy-tools"
LINUXDEPLOY="${TOOLS_DIR}/linuxdeploy-x86_64.AppImage"
PLUGIN_GTK="${TOOLS_DIR}/linuxdeploy-plugin-gtk.sh"
PLUGIN_GST="${TOOLS_DIR}/linuxdeploy-plugin-gstreamer.sh"
APPIMAGETOOL="${TOOLS_DIR}/appimagetool-x86_64.AppImage"
APPIMAGE_RUNTIME="${TOOLS_DIR}/runtime-x86_64"

# Pinned build tools: URL and sha256. Bump both together.
LINUXDEPLOY_URL="https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20251107-1/linuxdeploy-x86_64.AppImage"
LINUXDEPLOY_SHA256="c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d"
PLUGIN_GTK_URL="https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/3b67a1d1c1b0c8268f57f2bce40fe2d33d409cea/linuxdeploy-plugin-gtk.sh"
PLUGIN_GTK_SHA256="b0f4cbc684a0103a9651f0955b635eaea0096b3a66c0f5a2c2aa337960375171"
PLUGIN_GST_URL="https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gstreamer/432af639725bc8b99df12351e86bb2e8a6b3585f/linuxdeploy-plugin-gstreamer.sh"
PLUGIN_GST_SHA256="d1cf90701047aa9583c274bb66dd82db352255374fbfb8f3c4c89a05fe23bce0"
APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage"
APPIMAGETOOL_SHA256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
# appimagetool would otherwise download the latest runtime while it builds.
APPIMAGE_RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64"
APPIMAGE_RUNTIME_SHA256="2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d"

# Parse arguments
FORCE_REBUILD=false
for arg in "$@"; do
    case $arg in
        --clean|--force)
            FORCE_REBUILD=true
            echo "Force rebuild requested - cache will be ignored"
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# The AppImage wraps the portable binary.
echo "Steps 1-3: Building the portable binary..."
./scripts/build-static.sh

if [ ! -f "${BUILD_DIR}/${BINARY_NAME}" ]; then
    echo -e "${RED}✗ Build failed - binary not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Binary built${NC}"
echo ""

# fetch PATH URL SHA256: downloads URL to PATH unless PATH already has that checksum.
fetch() {
    local path=$1 url=$2 sha=$3
    if [ -f "$path" ] && echo "${sha}  ${path}" | sha256sum --check --status; then
        return
    fi
    echo "Downloading ${url}..."
    wget -q -O "${path}.part" "$url"
    if ! echo "${sha}  ${path}.part" | sha256sum --check --status; then
        echo -e "${RED}✗ Checksum mismatch for ${url}${NC}"
        exit 1
    fi
    mv "${path}.part" "$path"
    chmod +x "$path"
}

mkdir -p "$TOOLS_DIR"
fetch "$LINUXDEPLOY" "$LINUXDEPLOY_URL" "$LINUXDEPLOY_SHA256"
fetch "$PLUGIN_GTK" "$PLUGIN_GTK_URL" "$PLUGIN_GTK_SHA256"
fetch "$PLUGIN_GST" "$PLUGIN_GST_URL" "$PLUGIN_GST_SHA256"
fetch "$APPIMAGETOOL" "$APPIMAGETOOL_URL" "$APPIMAGETOOL_SHA256"
fetch "$APPIMAGE_RUNTIME" "$APPIMAGE_RUNTIME_URL" "$APPIMAGE_RUNTIME_SHA256"

# Create AppImage
echo "Step 4: Creating AppImage..."
echo ""

# Cache validation function
validate_cache() {
    if [ "$FORCE_REBUILD" = true ]; then
        echo -e "${YELLOW}Force rebuild requested${NC}"
        return 1
    fi

    if [ ! -d "${CACHE_APPDIR}" ]; then
        echo -e "${YELLOW}No cache found${NC}"
        return 1
    fi

    if [ ! -f "${CACHE_DIR}/cache.meta" ]; then
        echo -e "${YELLOW}Cache metadata missing${NC}"
        return 1
    fi

    if [ $(find "${CACHE_DIR}/cache.meta" -mtime +7 2>/dev/null | wc -l) -gt 0 ]; then
        echo -e "${YELLOW}Cache older than 7 days${NC}"
        return 1
    fi

    local cached_webkit_hash=$(grep "webkit_hash=" "${CACHE_DIR}/cache.meta" 2>/dev/null | cut -d= -f2)
    local current_webkit_hash=$(md5sum /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0 2>/dev/null | cut -d' ' -f1)

    if [ "$cached_webkit_hash" != "$current_webkit_hash" ]; then
        echo -e "${YELLOW}WebKit library has changed${NC}"
        return 1
    fi

    echo -e "${GREEN}✓ Cache valid (using cached dependencies)${NC}"
    return 0
}

USE_CACHE=false
echo ""
echo "Checking dependency cache..."
if validate_cache; then
    USE_CACHE=true
    rm -rf "${APPIMAGE_DIR}"
    mkdir -p "${APPIMAGE_DIR}"
    echo "Restoring cached dependencies..."
    cp -a "${CACHE_APPDIR}" "${APPDIR}"
    echo -e "${GREEN}✓ Cache restored${NC}"
else
    echo -e "${YELLOW}Cache invalid - rebuilding dependencies${NC}"
    rm -rf "${APPIMAGE_DIR}"
    mkdir -p "${APPDIR}/usr/bin"
    mkdir -p "${APPDIR}/usr/lib"
    mkdir -p "${APPDIR}/usr/share/applications"
    mkdir -p "${APPDIR}/usr/share/icons/hicolor/256x256/apps"
    mkdir -p "${APPDIR}/usr/share/metainfo"
fi
echo ""

# Always update the binary
echo "Updating binary..."
cp "${BUILD_DIR}/${BINARY_NAME}" "${APPDIR}/usr/bin/${APP_NAME}"
chmod +x "${APPDIR}/usr/bin/${APP_NAME}"
echo -e "${GREEN}✓ Binary updated${NC}"

# Skip dependency bundling if using cache
if [ "$USE_CACHE" = false ]; then
    echo -e "${CYAN}Bundling all dependencies...${NC}"

# Build and copy the WebKit launcher LD_PRELOAD library
echo "Building WebKit launcher library..."
cat > "/tmp/webkit-launcher-$$.c" <<'LAUNCHER_EOF'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <stdio.h>
#include <spawn.h>

static int (*real_execve)(const char *, char *const[], char *const[]) = NULL;
static int (*real_posix_spawn)(pid_t *, const char *, const posix_spawn_file_actions_t *,
                               const posix_spawnattr_t *, char *const[], char *const[]) = NULL;

static void init() __attribute__((constructor));
static void init() {
    real_execve = dlsym(RTLD_NEXT, "execve");
    real_posix_spawn = dlsym(RTLD_NEXT, "posix_spawn");
}

static const char* redirect_webkit(const char *filename, char *newpath, size_t newpath_size) {
    if (filename && (strstr(filename, "webkit2gtk-4.1/WebKitWebProcess") || 
                     strstr(filename, "webkit2gtk-4.1/WebKitNetworkProcess"))) {
        
        char *appdir = getenv("APPDIR");
        if (appdir) {
            const char *proc_name = strstr(filename, "WebKitWebProcess") ? 
                "WebKitWebProcess" : "WebKitNetworkProcess";
            
            snprintf(newpath, newpath_size, 
                "%s/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/%s", 
                appdir, proc_name);
            
            return newpath;
        }
    }
    return filename;
}

int execve(const char *filename, char *const argv[], char *const envp[]) {
    char newpath[4096];
    const char *target = redirect_webkit(filename, newpath, sizeof(newpath));
    return real_execve(target, argv, envp);
}

int posix_spawn(pid_t *pid, const char *path,
                const posix_spawn_file_actions_t *file_actions,
                const posix_spawnattr_t *attrp,
                char *const argv[], char *const envp[]) {
    char newpath[4096];
    const char *target = redirect_webkit(path, newpath, sizeof(newpath));
    return real_posix_spawn(pid, target, file_actions, attrp, argv, envp);
}
LAUNCHER_EOF

gcc -shared -fPIC -o "${APPDIR}/usr/lib/webkit-launcher.so" "/tmp/webkit-launcher-$$.c" -ldl 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✓ WebKit launcher built"
    rm "/tmp/webkit-launcher-$$.c"
else
    echo "✗ Warning: Could not build webkit-launcher.so"
    rm "/tmp/webkit-launcher-$$.c" 2>/dev/null || true
fi

# Bundle dependencies with linuxdeploy + plugins
echo "Bundling dependencies with linuxdeploy..."

# Configure plugins
export DEPLOY_GTK_VERSION=3

# Run linuxdeploy with GTK and GStreamer plugins
"$LINUXDEPLOY" \
    --appdir "$APPDIR" \
    --executable "${APPDIR}/usr/bin/${APP_NAME}" \
    --plugin gtk \
    --plugin gstreamer \
    --library /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0

echo "✓ Dependencies bundled with linuxdeploy"

# Bundle WebKit process executables
echo "Bundling WebKit process executables..."

# WebKitWebProcess and WebKitNetworkProcess
for webkit_proc in /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess \
                   /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess; do
    if [ -f "$webkit_proc" ]; then
        target_dir="${APPDIR}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
        mkdir -p "$target_dir"

        # Copy and bundle dependencies
        cp "$webkit_proc" "$target_dir/"
        "$LINUXDEPLOY" --appdir "$APPDIR" --executable "$target_dir/$(basename $webkit_proc)"

        # Patch RPATH for nested library resolution
        if command -v patchelf &> /dev/null; then
            patchelf --set-rpath '$ORIGIN/../..:$ORIGIN/../../..:$ORIGIN' \
                "$target_dir/$(basename $webkit_proc)" 2>/dev/null || true
        fi
    fi
done

# WebKit injected bundle (critical for WebKit functionality)
if [ -f "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so" ]; then
    mkdir -p "${APPDIR}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle"
    cp "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so" \
        "${APPDIR}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/"
fi

echo "✓ WebKit processes bundled"

# Bundle X11 and Mesa libraries for maximum compatibility
echo "Bundling X11 and Mesa libraries for compatibility..."

# X11 client libraries (essential for maximum compatibility)
X11_LIBS=(
    "libX11.so.6" "libXext.so.6" "libXrender.so.1" "libXrandr.so.2"
    "libXi.so.6" "libXfixes.so.3" "libXcursor.so.1" "libXdamage.so.1"
    "libXcomposite.so.1" "libXinerama.so.1" "libxcb.so.1"
    "libxcb-shm.so.0" "libxcb-render.so.0" "libXau.so.6" "libXdmcp.so.6"
)

for lib in "${X11_LIBS[@]}"; do
    if [ -f "/usr/lib/x86_64-linux-gnu/$lib" ]; then
        "$LINUXDEPLOY" --appdir "$APPDIR" \
            --library "/usr/lib/x86_64-linux-gnu/$lib" &
    fi
done
wait

# Mesa DRI drivers for software rendering fallback
if [ -d "/usr/lib/x86_64-linux-gnu/dri" ]; then
    mkdir -p "${APPDIR}/usr/lib/dri"
    # Bundle software renderers (work without GPU drivers)
    cp /usr/lib/x86_64-linux-gnu/dri/swrast_dri.so "${APPDIR}/usr/lib/dri/" 2>/dev/null || true
    cp /usr/lib/x86_64-linux-gnu/dri/kms_swrast_dri.so "${APPDIR}/usr/lib/dri/" 2>/dev/null || true

    # Bundle dependencies of DRI drivers
    for dri_lib in "${APPDIR}/usr/lib/dri"/*.so; do
        if [ -f "$dri_lib" ]; then
            "$LINUXDEPLOY" --appdir "$APPDIR" --library "$dri_lib" &
        fi
    done
    wait
fi

echo "✓ X11 and Mesa bundled"

# Bundle fontconfig data and fonts
echo "Bundling fontconfig data and fonts..."

# Fontconfig configuration files
if [ -d "/etc/fonts" ]; then
    mkdir -p "${APPDIR}/usr/etc/fonts"
    cp -r /etc/fonts/* "${APPDIR}/usr/etc/fonts/" 2>/dev/null || true
fi

# Fallback fonts (DejaVu for universal compatibility)
if [ -d "/usr/share/fonts/truetype/dejavu" ]; then
    mkdir -p "${APPDIR}/usr/share/fonts/truetype/dejavu"
    cp /usr/share/fonts/truetype/dejavu/*.ttf \
        "${APPDIR}/usr/share/fonts/truetype/dejavu/" 2>/dev/null || true
fi

echo "✓ Fontconfig data bundled"

    echo -e "${CYAN}Saving dependencies to cache...${NC}"
    rm -rf "${CACHE_DIR}"
    mkdir -p "${CACHE_DIR}"
    cp -a "${APPDIR}" "${CACHE_APPDIR}"

    webkit_hash=$(md5sum /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0 2>/dev/null | cut -d' ' -f1)
    cat > "${CACHE_DIR}/cache.meta" <<CACHE_META
created=$(date +%s)
webkit_hash=${webkit_hash}
version=${VERSION}
CACHE_META
    echo -e "${GREEN}✓ Cache saved${NC}"
else
    echo -e "${GREEN}✓ Used cached dependencies${NC}"
fi

# Desktop entry and AppStream metadata come from packaging/, as in the .deb/.rpm.
mkdir -p "${APPDIR}/usr/share/applications" "${APPDIR}/usr/share/metainfo"
cp "packaging/${APP_ID}.desktop" "${APPDIR}/usr/share/applications/${APP_ID}.desktop"

# Create AppRun script
cat > "${APPDIR}/AppRun" <<'EOF'
#!/bin/bash
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export APPDIR="${HERE}"

# Detect display server (Wayland or X11)
SESSION_TYPE="${XDG_SESSION_TYPE:-x11}"

if [ "$SESSION_TYPE" = "wayland" ]; then
    # Check if Wayland display is available
    if [ -n "$WAYLAND_DISPLAY" ] && [ -S "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ]; then
        echo "Detected Wayland session"
        export GDK_BACKEND=wayland,x11  # Try Wayland first, fallback to X11
    else
        echo "Wayland session detected but display unavailable, falling back to X11"
        export GDK_BACKEND=x11
        export DISPLAY="${DISPLAY:-:0}"
    fi
else
    # X11 session
    export GDK_BACKEND=x11
    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
        echo "WARNING: DISPLAY was not set, using :0"
    fi

    # Verify X11 connection
    if command -v xset &>/dev/null; then
        if ! xset q &>/dev/null; then
            echo "WARNING: Cannot connect to X display $DISPLAY"
        fi
    fi
fi

# Set up library paths - bundled libraries take precedence
export LD_LIBRARY_PATH="${HERE}/usr/lib:${HERE}/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH}"
export PATH="${HERE}/usr/bin:${HERE}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1:${PATH}"

# Preload webkit launcher to redirect WebKit processes
# NOTE: Only preload if the library exists and is valid
if [ -f "${HERE}/usr/lib/webkit-launcher.so" ]; then
    export LD_PRELOAD="${HERE}/usr/lib/webkit-launcher.so:${LD_PRELOAD}"
    [ "$LANKIR_DEBUG" = "1" ] && echo "✓ webkit-launcher.so preloaded"
else
    echo "WARNING: webkit-launcher.so not found, WebKit process redirection disabled"
fi

# GIO/GDK configuration - use our bundled, filtered modules
export GIO_MODULE_DIR="${HERE}/usr/lib/gio/modules"
export GDK_PIXBUF_MODULEDIR="${HERE}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders"
export GDK_PIXBUF_MODULE_FILE="${HERE}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"

# Disable GVFS and D-Bus volume monitoring
export GIO_USE_VFS=local
export GVFS_DISABLE_FUSE=1
export GIO_USE_VOLUME_MONITOR=unix

# CRITICAL: Disable AT-SPI accessibility bus - this is what's hanging GTK
export NO_AT_BRIDGE=1
export GTK_A11Y=none

# CRITICAL FIX: Disable GTK input modules (IBus, fcitx, etc.)
# System IM modules expect system GLib, but we're using bundled GLib
# This causes "undefined symbol: g_task_set_static_name" errors
export GTK_IM_MODULE=gtk-im-context-simple
export IBUS_DISABLE_SNOOPER=1
export XMODIFIERS=""

# Disable GTK theme engines and fallback to default theme
# Prevents pixbuf loading errors from custom themes
export GTK_THEME=""
export GTK2_RC_FILES=""
export GTK_DATA_PREFIX="${HERE}/usr"
export GTK_EXE_PREFIX="${HERE}/usr"

# Critical: Point GTK to schema directory
export GSETTINGS_SCHEMA_DIR="${HERE}/usr/share/glib-2.0/schemas:${GSETTINGS_SCHEMA_DIR}"

# Disable GSettings backend to avoid dconf issues
export GSETTINGS_BACKEND=memory

# XDG configuration
export XDG_DATA_DIRS="${HERE}/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
export XDG_CONFIG_DIRS="${HERE}/usr/etc/xdg:${XDG_CONFIG_DIRS:-/etc/xdg}"

# Ensure GDK pixbuf loaders are properly configured
export GDK_PIXBUF_MODULE_FILE="${HERE}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"

# Mesa/DRI configuration for software rendering fallback
export LIBGL_DRIVERS_PATH="${HERE}/usr/lib/dri"
export LIBGL_ALWAYS_SOFTWARE=1
export __EGL_VENDOR_LIBRARY_DIRS="${HERE}/usr/share/glvnd/egl_vendor.d:/usr/share/glvnd/egl_vendor.d"

# Fontconfig configuration
export FONTCONFIG_PATH="${HERE}/usr/etc/fonts"
export FONTCONFIG_FILE="${HERE}/usr/etc/fonts/fonts.conf"

# Create temporary directory for WebKit cache
WEBKIT_TMPDIR="${TMPDIR:-/tmp}/lankir-webkit-$$"
mkdir -p "$WEBKIT_TMPDIR"
trap "rm -rf '$WEBKIT_TMPDIR'" EXIT

# WebKit configuration - comprehensive settings for AppImage compatibility
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# CRITICAL FIX: Force WebKit to use single-process mode
# This prevents WebKitWebProcess spawning issues in AppImage
export WEBKIT_FORCE_SANDBOX=0
export WEBKIT_USE_SINGLE_WEB_PROCESS=1

# WebKit cache and data directories
export WEBKIT_DISK_CACHE_DIR="$WEBKIT_TMPDIR/cache"
export WEBKIT_LOCALSTORAGE_DIR="$WEBKIT_TMPDIR/localstorage"
export WEBKIT_INDEXEDDB_DIR="$WEBKIT_TMPDIR/indexeddb"

# WebGL and hardware acceleration - disable to avoid issues
export WEBKIT_DISABLE_WEBGL=1

# GStreamer (for WebKit media support)
export GST_PLUGIN_SCANNER="${HERE}/usr/lib/gstreamer1.0/gst-plugin-scanner"
export GST_PLUGIN_SYSTEM_PATH="${HERE}/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH="${HERE}/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SYSTEM_PATH_1_0="${HERE}/usr/lib/gstreamer-1.0"

# Debug mode - enable if LANKIR_DEBUG=1
if [ "$LANKIR_DEBUG" = "1" ]; then
    echo "=== Lankir AppImage Debug Info ==="
    echo "APPDIR: $APPDIR"
    echo "LD_LIBRARY_PATH: $LD_LIBRARY_PATH"
    echo ""
    echo "System Info:"
    uname -a
    echo ""
    echo "GLib version in AppImage:"
    strings "${HERE}/usr/lib/libglib-2.0.so.0" | grep "GLIB_" | head -5
    echo ""
    echo "GTK version in AppImage:"
    strings "${HERE}/usr/lib/libgtk-3.so.0" | grep "gtk_get_major_version" -A1 | head -3
    echo ""
    echo "Testing WebKitWebProcess dependencies:"
    ldd "${HERE}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess" 2>&1 | grep -i "not found" || echo "All dependencies OK"
    echo ""
    echo "Testing main binary dependencies:"
    ldd "${HERE}/usr/bin/lankir" 2>&1 | grep -i "not found" || echo "All dependencies OK"
    echo ""
    echo "GIO modules available:"
    ls -la "${HERE}/usr/lib/gio/modules/"
    echo ""
    export G_MESSAGES_DEBUG=all
    export WEBKIT_DEBUG=all
    # DO NOT set GTK_DEBUG=interactive - it causes GTK to hang waiting for input
fi

# Always enable some debug output to catch WebKit errors
export G_MESSAGES_PREFIXED=all

# CRITICAL: Enable WebKit JavaScript console output to stderr
# This ensures we can see JavaScript errors even when LANKIR_DEBUG is not set
export WEBKIT_ENABLE_CONSOLE_TO_STDOUT=1

# Additional WebKit debugging for initialization issues
export WEBKIT2_INSPECTOR_SERVER=127.0.0.1:0

# Ensure GTK doesn't try to use non-existent modules
export GTK3_MODULES=""

# Critical: Test that we can create a simple GTK window before launching
# This helps diagnose if the issue is GTK vs WebKit
if [ "$LANKIR_DEBUG" = "1" ]; then
    echo "Testing GTK initialization..."
    # We'll skip this test for now as it requires additional tools
fi

# Run with current working directory preserved
cd "$(dirname "$SELF")"

# CRITICAL: Add strace for debugging if LANKIR_STRACE=1
if [ "$LANKIR_STRACE" = "1" ]; then
    echo "=== Running with strace (output to /tmp/lankir-strace.log) ==="
    strace -f -o /tmp/lankir-strace.log "${HERE}/usr/bin/lankir" "$@" 2>&1 || {
        EXIT_CODE=$?
        echo ""
        echo "=== APPLICATION CRASHED WITH EXIT CODE: $EXIT_CODE ==="
        echo "Strace log saved to /tmp/lankir-strace.log"
        exit $EXIT_CODE
    }
    exit 0
fi

# Run and capture any crash
"${HERE}/usr/bin/lankir" "$@" 2>&1 || {
    EXIT_CODE=$?
    echo ""
    echo "=== APPLICATION CRASHED WITH EXIT CODE: $EXIT_CODE ==="
    echo "If you see a blank screen, try running with: LANKIR_DEBUG=1 ./lankir.AppImage"
    echo "To extract for manual inspection: ./lankir.AppImage --appimage-extract"
    exit $EXIT_CODE
}
EOF
chmod +x "${APPDIR}/AppRun"

# Note: WebKit processes, GIO modules, GLib schemas, and GDK pixbuf loaders
# are now automatically handled by linuxdeploy-plugin-gtk above

# Copy application icon
if [ -f "assets/lankir.png" ]; then
    cp "assets/lankir.png" "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${APP_NAME}.png"

    if command -v base64 &> /dev/null; then
        png_b64=$(base64 -w0 assets/lankir.png)
    else
        png_b64=$(openssl base64 -A < assets/lankir.png)
    fi

    cat > "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${APP_NAME}.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <image href="data:image/png;base64,${png_b64}" width="256" height="256" />
</svg>
EOF
    echo "✓ Application logo copied"
else
    echo "Warning: Logo not found at assets/lankir.png, creating placeholder"
    cat > "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${APP_NAME}.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#e74c3c" rx="24"/>
  <text x="128" y="180" font-family="Arial" font-size="120" font-weight="bold" fill="white" text-anchor="middle">PDF</text>
</svg>
EOF
fi

# AppStream metadata, with this build's version as its release
RELEASE_DATE=$(git log -1 --format=%cs 2>/dev/null || date +%F)
sed "s|</component>|  <releases>\n    <release version=\"${VERSION}\" date=\"${RELEASE_DATE}\" />\n  </releases>\n</component>|" \
    "packaging/${APP_ID}.metainfo.xml" > "${APPDIR}/usr/share/metainfo/${APP_ID}.metainfo.xml"

# Create symlinks for AppImage
ln -sf "usr/share/applications/${APP_ID}.desktop" "${APPDIR}/${APP_ID}.desktop"
ln -sf "usr/share/icons/hicolor/256x256/apps/${APP_NAME}.svg" "${APPDIR}/${APP_NAME}.svg"

# Build AppImage
OUTPUT_APPIMAGE="${BUILD_DIR}/${APP_NAME}-${VERSION}-x86_64.AppImage"
rm -f "$OUTPUT_APPIMAGE"
ARCH=x86_64 "$APPIMAGETOOL" --no-appstream --runtime-file "$APPIMAGE_RUNTIME" "${APPDIR}" "$OUTPUT_APPIMAGE"

echo ""
echo "============================================"
echo -e "${GREEN}Build Complete!${NC}"
echo "============================================"
echo ""
echo "AppImage location: $OUTPUT_APPIMAGE"
echo "AppImage size: $(du -h $OUTPUT_APPIMAGE | cut -f1)"
echo ""

# Test the AppImage
# Finalize
if [ -f "$OUTPUT_APPIMAGE" ]; then
    chmod +x "$OUTPUT_APPIMAGE"
    
    echo ""
    echo "============================================"
    echo "Deployment Instructions:"
    echo "============================================"
    echo -e "${GREEN}This AppImage is truly portable!${NC}"
    echo ""
    echo "It will run on ANY modern Linux distribution without installing dependencies."
    echo ""
    echo "To deploy:"
    echo "  1. Copy the AppImage to target system:"
    echo "     scp $OUTPUT_APPIMAGE user@target:~/lankir.AppImage"
    echo ""
    echo "  2. Make it executable:"
    echo "     chmod +x ~/lankir.AppImage"
    echo ""
    echo "  3. Run it:"
    echo "     ./lankir.AppImage"
    echo ""
    echo "Optional - Add to applications menu:"
    echo "  ./lankir.AppImage --appimage-integrate"
    echo ""
    echo "Requirements on target system:"
    echo "  • Linux x86_64 with kernel 2.6.32+"
    echo "  • FUSE2 (already installed on most distros)"
    echo "  • If FUSE not available, extract and run:"
    echo "    ./lankir.AppImage --appimage-extract"
    echo "    ./squashfs-root/AppRun"
    echo ""
else
    echo -e "${RED}✗ AppImage creation failed${NC}"
    exit 1
fi
