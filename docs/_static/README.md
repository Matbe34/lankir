# Static Assets

This directory holds static files for the PDF App documentation.

## Required Assets

### Branding

| File | Size | Format | Description |
|------|------|--------|-------------|
| `logo.png` | 512×512 | PNG (transparent) | Documentation logo, shown in sidebar |
| `favicon.ico` | 32×32 or 48×48 | ICO or PNG | Browser tab icon |

### Hero Screenshot

| File | Size | Format | Description |
|------|------|--------|-------------|
| `screenshot.png` | 1200×800 | PNG | Main application screenshot for homepage |

## Screenshot Requirements

Create a `screenshots/` subdirectory with the following images:

### Getting Started Screenshots

| File | Size | Description |
|------|------|-------------|
| `screenshots/main-window.png` | 1200×800 | Main window after launch (welcome screen) |
| `screenshots/pdf-open.png` | 1200×800 | PDF document open with thumbnail sidebar |
| `screenshots/sign-dialog.png` | 800×600 | Signature dialog with certificate selection |
| `screenshots/settings-panel.png` | 800×600 | Settings/preferences panel |

### User Guide Screenshots

| File | Size | Description |
|------|------|-------------|
| `screenshots/viewer-overview.png` | 1200×800 | Full viewer with multi-page PDF |
| `screenshots/sidebar-thumbnails.png` | 400×600 | Close-up of thumbnail sidebar |
| `screenshots/signing-workflow.png` | 1200×800 | Signing in progress |
| `screenshots/sign-button.png` | 600×100 | Toolbar with Sign button highlighted |
| `screenshots/visible-signature.png` | 400×300 | Close-up of visible signature on page |
| `screenshots/certificate-list.png` | 1200×800 | Certificate management panel |
| `screenshots/signature-profile-editor.png` | 800×600 | Profile editor dialog |
| `screenshots/verification-panel.png` | 800×600 | Verification results |

## Creating Screenshots

### Guidelines

1. **Resolution**: Use 2x resolution if possible, then scale down
2. **Theme**: Use dark theme for consistency
3. **Content**: Use sample/test PDFs, not real documents
4. **Personal Info**: Remove or blur any personal information
5. **Window Decorations**: Include native window decorations for context

### Capturing on Linux

```bash
# Using gnome-screenshot
gnome-screenshot -w -f screenshot.png

# Using scrot
scrot -s screenshot.png

# Using Flameshot
flameshot gui
```

### Post-Processing

```bash
# Resize to target dimensions (ImageMagick)
convert screenshot.png -resize 1200x800 screenshot_resized.png

# Optimize file size
optipng screenshot.png
# or
pngquant --quality=85-95 screenshot.png
```

## Creating Placeholder Images

If you don't have the application running, create placeholder images:

```bash
# Create placeholder logo (requires ImageMagick)
convert -size 512x512 xc:'#1e1e1e' \
    -fill '#007acc' -draw "circle 256,256 256,128" \
    -fill white -gravity center -pointsize 120 \
    -annotate 0 "PDF" \
    logo.png

# Create placeholder favicon
convert -size 48x48 xc:'#007acc' \
    -fill white -gravity center -pointsize 24 \
    -annotate 0 "P" \
    favicon.png
convert favicon.png favicon.ico

# Create placeholder screenshot
convert -size 1200x800 xc:'#2d2d2d' \
    -fill '#3d3d3d' -draw "rectangle 0,0 200,800" \
    -fill '#1e1e1e' -draw "rectangle 200,0 1200,50" \
    -fill white -gravity center -pointsize 48 \
    -annotate 0 "Screenshot Placeholder" \
    screenshot.png
```

## Directory Structure

After adding all assets:

```
_static/
├── README.md           # This file
├── logo.png            # Documentation logo
├── favicon.ico         # Browser favicon
├── screenshot.png      # Hero screenshot
├── custom.css          # Custom styles (optional)
└── screenshots/
    ├── main-window.png
    ├── pdf-open.png
    ├── sign-dialog.png
    ├── settings-panel.png
    ├── viewer-overview.png
    ├── sidebar-thumbnails.png
    ├── signing-workflow.png
    ├── sign-button.png
    ├── visible-signature.png
    ├── certificate-list.png
    ├── signature-profile-editor.png
    └── verification-panel.png
```

## License

All assets in this directory should be:
- Created specifically for PDF App, OR
- Licensed under a compatible open-source license (CC0, CC-BY, MIT, etc.)

Do not include copyrighted images without proper licensing.
