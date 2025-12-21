# Viewing PDFs

PDF App provides a high-quality PDF viewing experience powered by the MuPDF rendering engine.

```{figure} ../_static/screenshots/viewer-overview.png
:alt: PDF viewer interface overview
:width: 100%

*PDF viewer with document, thumbnail sidebar, and navigation controls*
```

```{note}
**Screenshot needed:** `_static/screenshots/viewer-overview.png` — Full application window with a multi-page PDF open, showing thumbnail sidebar, main viewer area, and toolbar.
```

## Opening Documents

### From the GUI

- **File menu**: File → Open (`Ctrl+O`)
- **Drag and drop**: Drag PDF files onto the window
- **Recent files**: Select from the sidebar or File → Recent
- **Command line**: `pdf-app /path/to/document.pdf`

### From the CLI

```bash
# Get PDF information
pdf-app pdf info document.pdf

# Output as JSON
pdf-app pdf info document.pdf --json
```

## Navigation

### Page Navigation

| Method | Action |
|--------|--------|
| Keyboard | `←`/`→`, `Page Up`/`Page Down` |
| Sidebar | Click thumbnail |
| Go to page | `Ctrl+G` → enter page number |
| First/Last | `Home`/`End` |

### Scrolling

- **Mouse wheel**: Scroll up/down
- **Trackpad**: Two-finger scroll
- **Spacebar**: Page down
- **Shift+Spacebar**: Page up

## Zoom Controls

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Zoom in | `Ctrl++` or `Ctrl+=` |
| Zoom out | `Ctrl+-` |
| Actual size (100%) | `Ctrl+0` |
| Fit width | `Ctrl+1` |
| Fit page | `Ctrl+2` |

### Mouse Zoom

- `Ctrl+Scroll`: Zoom in/out at cursor position
- Pinch gesture (touchpad): Zoom in/out

### Zoom Levels

Available zoom levels: 25%, 50%, 75%, 100%, 125%, 150%, 200%, 300%, 400%

The default zoom level is configurable:
```bash
pdf-app config set defaultZoom 150
```

## View Modes

### Scroll Mode (Default)

All pages displayed in a continuous vertical scroll. Best for reading documents.

### Single Page Mode

One page at a time, centered in the view. Best for presentations or detailed examination.

Switch modes:
```bash
pdf-app config set defaultViewMode scroll  # or "single"
```

## Sidebar

### Left Sidebar (Thumbnails)

- Page thumbnails for quick navigation
- Click any thumbnail to jump to that page
- Current page highlighted
- Toggle: View → Sidebar or click sidebar button

```{figure} ../_static/screenshots/sidebar-thumbnails.png
:alt: Thumbnail sidebar showing page previews
:width: 40%
:align: center

*Thumbnail sidebar with current page highlighted*
```

```{note}
**Screenshot needed:** `_static/screenshots/sidebar-thumbnails.png` — Close-up of the thumbnail sidebar showing several page previews with one highlighted.
```

### Recent Files

Quick access to recently opened documents. The number of files remembered is configurable:
```bash
pdf-app config set recentFilesLength 10
```

## Document Information

View document metadata:

### GUI
File → Properties or `Ctrl+I`

### CLI
```bash
pdf-app pdf info document.pdf
```

**Output includes:**
- Title, Author, Subject
- Creator application
- Page count
- PDF version
- File size
- Creation/modification dates

## Page Information

Get page dimensions:

```bash
pdf-app pdf pages document.pdf

# Output:
# Page Dimensions:
#   Page 1: 612.00 x 792.00 pts
#   Page 2: 612.00 x 792.00 pts
```

Standard page sizes in points:
- **Letter**: 612 × 792
- **A4**: 595 × 842
- **Legal**: 612 × 1008

## Rendering Pages

Export pages as images:

```bash
# Render page 1 at default DPI (150)
pdf-app pdf render document.pdf --page 1 --output page1.png

# Render at 300 DPI for printing
pdf-app pdf render document.pdf --page 1 --dpi 300 --output page1_hires.png

# Generate thumbnail (72 DPI)
pdf-app pdf thumbnail document.pdf --page 1 --size 200 --output thumb.png
```

## Annotations

PDF App displays standard PDF annotations:
- Text annotations (sticky notes)
- Highlight, underline, strikethrough
- Links (clickable)
- Form fields (read-only)

:::{note}
Annotation editing is not yet supported. Annotations are rendered as part of the page.
:::

## Performance Tips

### Large Documents

For PDFs with many pages (100+):
- Thumbnails load progressively
- Pages render on-demand as you scroll
- Memory is managed automatically

### Slow Rendering

If rendering is slow:
1. Reduce zoom level
2. Disable hardware acceleration:
   ```bash
   pdf-app config set hardwareAccel false
   ```
3. Close other resource-intensive applications

## Keyboard Reference

| Action | Shortcut |
|--------|----------|
| Open file | `Ctrl+O` |
| Close file | `Ctrl+W` |
| Page down | `Space`, `→`, `Page Down` |
| Page up | `Shift+Space`, `←`, `Page Up` |
| First page | `Home` |
| Last page | `End` |
| Go to page | `Ctrl+G` |
| Zoom in | `Ctrl++` |
| Zoom out | `Ctrl+-` |
| Fit width | `Ctrl+1` |
| Fit page | `Ctrl+2` |
| Actual size | `Ctrl+0` |
| Toggle sidebar | `Ctrl+B` |
| Properties | `Ctrl+I` |
| Settings | `Ctrl+,` |

## Next Steps

- [Digital Signatures](signing.md) - Sign PDF documents
- [Signature Verification](verification.md) - Validate signatures
