# CLI Overview

PDF App provides a comprehensive command-line interface for automation and scripting.

## Basic Usage

```bash
pdf-app <command> [subcommand] [options] [arguments]
```

When run without arguments, PDF App launches the GUI. With any arguments, it runs in CLI mode.

## Global Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help for command |
| `--verbose`, `-v` | Enable verbose/debug logging |
| `--json` | Output in JSON format (where supported) |

## Command Groups

| Command | Description |
|---------|-------------|
| `pdf` | PDF file operations (info, render, pages) |
| `cert` | Certificate management (list, search) |
| `sign` | Signing operations (sign, verify, profiles) |
| `config` | Configuration management (get, set, reset) |
| `gui` | Launch the graphical interface |

## Quick Examples

```bash
# View PDF information
pdf-app pdf info document.pdf

# List available certificates
pdf-app cert list --valid-only

# Sign a PDF
pdf-app sign pdf input.pdf output.pdf --cert ABC123...

# Verify signatures
pdf-app sign verify signed.pdf

# View configuration
pdf-app config get
```

## Getting Help

```bash
# General help
pdf-app --help

# Command-specific help
pdf-app pdf --help
pdf-app sign pdf --help
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |

## Output Formats

### Human-Readable (Default)

```bash
pdf-app pdf info document.pdf

# Output:
PDF Information:
  File:       document.pdf
  Title:      Annual Report
  Pages:      42
```

### JSON

```bash
pdf-app pdf info document.pdf --json

# Output:
{
  "filePath": "document.pdf",
  "title": "Annual Report",
  "pageCount": 42
}
```

## Verbose Mode

Enable detailed logging for debugging:

```bash
pdf-app --verbose sign pdf doc.pdf out.pdf --cert ABC123...

# Outputs debug information to stderr
```

## Piping and Scripting

### Combining with Other Tools

```bash
# Count pages in multiple PDFs
for pdf in *.pdf; do
    pages=$(pdf-app pdf info "$pdf" --json | jq '.pageCount')
    echo "$pdf: $pages pages"
done

# Find signed PDFs
for pdf in *.pdf; do
    if pdf-app sign verify "$pdf" --json 2>/dev/null | jq -e '.[0]' > /dev/null; then
        echo "$pdf is signed"
    fi
done
```

### Error Handling

```bash
#!/bin/bash
set -e

pdf-app sign pdf input.pdf output.pdf --cert "$CERT" || {
    echo "Signing failed" >&2
    exit 1
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_APP_CONFIG_DIR` | Override config directory |
| `PDF_APP_DEBUG` | Enable debug mode (`1` or `true`) |

## Next Steps

- [PDF Commands](pdf-commands.md) - File operations
- [Certificate Commands](cert-commands.md) - Certificate management
- [Sign Commands](sign-commands.md) - Signing and verification
- [Config Commands](config-commands.md) - Configuration
