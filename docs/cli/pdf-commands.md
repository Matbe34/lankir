# PDF Commands

Commands for PDF file operations.

## pdf info

Display PDF metadata and properties.

```bash
pdf-app pdf info <pdf-file> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Human-readable output
pdf-app pdf info document.pdf

# Output:
PDF Information:
  File:       /path/to/document.pdf
  Title:      Annual Report 2025
  Author:     Jane Smith
  Subject:    Financial Summary
  Creator:    Microsoft Word
  Pages:      42

# JSON output
pdf-app pdf info document.pdf --json
```

### JSON Output

```json
{
  "filePath": "/path/to/document.pdf",
  "title": "Annual Report 2025",
  "author": "Jane Smith",
  "subject": "Financial Summary",
  "creator": "Microsoft Word",
  "pageCount": 42
}
```

## pdf pages

Display page dimensions for each page.

```bash
pdf-app pdf pages <pdf-file> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Human-readable output
pdf-app pdf pages document.pdf

# Output:
Page Dimensions:
  Page 1: 612.00 x 792.00 pts
  Page 2: 612.00 x 792.00 pts
  Page 3: 842.00 x 595.00 pts  # Landscape A4

# JSON output
pdf-app pdf pages document.pdf --json
```

### JSON Output

```json
[
  {"page": 1, "width": 612, "height": 792},
  {"page": 2, "width": 612, "height": 792},
  {"page": 3, "width": 842, "height": 595}
]
```

## pdf render

Render a PDF page to a PNG image.

```bash
pdf-app pdf render <pdf-file> [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--page`, `-p` | 1 | Page number to render |
| `--dpi`, `-d` | 150 | Resolution in DPI |
| `--output`, `-o` | (auto) | Output file path |

### Examples

```bash
# Render first page at default DPI
pdf-app pdf render document.pdf --output page1.png

# Render page 5 at 300 DPI (print quality)
pdf-app pdf render document.pdf --page 5 --dpi 300 --output page5_hires.png

# Render at screen resolution (72 DPI)
pdf-app pdf render document.pdf --page 1 --dpi 72 --output preview.png
```

### DPI Guidelines

| DPI | Use Case | File Size |
|-----|----------|-----------|
| 72 | Screen preview | Small |
| 150 | Default, good quality | Medium |
| 300 | Print quality | Large |
| 600 | High-quality print | Very large |

## pdf thumbnail

Generate a thumbnail image of a page.

```bash
pdf-app pdf thumbnail <pdf-file> [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--page`, `-p` | 1 | Page number |
| `--size`, `-s` | 200 | Maximum dimension (width or height) |
| `--output`, `-o` | (auto) | Output file path |

### Examples

```bash
# Generate 200px thumbnail of first page
pdf-app pdf thumbnail document.pdf --output thumb.png

# Generate larger thumbnail of page 3
pdf-app pdf thumbnail document.pdf --page 3 --size 400 --output thumb_lg.png
```

## Scripting Examples

### Generate Thumbnails for All Pages

```bash
#!/bin/bash
pdf=$1
pages=$(pdf-app pdf info "$pdf" --json | jq '.pageCount')

mkdir -p thumbnails
for ((i=1; i<=pages; i++)); do
    pdf-app pdf thumbnail "$pdf" --page $i --output "thumbnails/page_$i.png"
done
```

### Batch PDF Info Report

```bash
#!/bin/bash
echo "File,Pages,Title,Author"
for pdf in *.pdf; do
    info=$(pdf-app pdf info "$pdf" --json)
    pages=$(echo "$info" | jq -r '.pageCount')
    title=$(echo "$info" | jq -r '.title // "Untitled"')
    author=$(echo "$info" | jq -r '.author // "Unknown"')
    echo "\"$pdf\",$pages,\"$title\",\"$author\""
done
```

### Find Large PDFs

```bash
#!/bin/bash
for pdf in *.pdf; do
    pages=$(pdf-app pdf info "$pdf" --json | jq '.pageCount')
    if [ "$pages" -gt 100 ]; then
        echo "$pdf has $pages pages"
    fi
done
```

### Render All Pages to Images

```bash
#!/bin/bash
pdf=$1
outdir=${2:-output}
dpi=${3:-150}

pages=$(pdf-app pdf info "$pdf" --json | jq '.pageCount')
mkdir -p "$outdir"

for ((i=1; i<=pages; i++)); do
    printf "Rendering page %d/%d...\r" $i $pages
    pdf-app pdf render "$pdf" --page $i --dpi $dpi --output "$outdir/page_$(printf '%04d' $i).png"
done
echo "Done! Rendered $pages pages to $outdir/"
```

## Error Handling

### File Not Found

```bash
pdf-app pdf info nonexistent.pdf
# Error: PDF file not found: nonexistent.pdf
# Exit code: 1
```

### Invalid PDF

```bash
pdf-app pdf info corrupted.pdf
# Error: failed to open PDF: invalid PDF format
# Exit code: 1
```

### Page Out of Range

```bash
pdf-app pdf render document.pdf --page 999
# Error: page 999 out of range (document has 42 pages)
# Exit code: 1
```

## Next Steps

- [Certificate Commands](cert-commands.md)
- [Sign Commands](sign-commands.md)
