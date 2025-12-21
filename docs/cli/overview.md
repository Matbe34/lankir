# CLI Overview

Lankir provides a comprehensive command-line interface for automation and scripting.

## Basic Usage

```bash
lankir <command> [subcommand] [options] [arguments]
```

When run without arguments, Lankir launches the GUI. With any arguments, it runs in CLI mode.

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
lankir pdf info document.pdf

# List available certificates
lankir cert list --valid-only

# Sign a PDF
lankir sign pdf input.pdf output.pdf --cert ABC123...

# Verify signatures
lankir sign verify signed.pdf

# View configuration
lankir config get
```

## Getting Help

```bash
# General help
lankir --help

# Command-specific help
lankir pdf --help
lankir sign pdf --help
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
lankir pdf info document.pdf

# Output:
PDF Information:
  File:       document.pdf
  Title:      Annual Report
  Pages:      42
```

### JSON

```bash
lankir pdf info document.pdf --json

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
lankir --verbose sign pdf doc.pdf out.pdf --cert ABC123...

# Outputs debug information to stderr
```

## Piping and Scripting

### Combining with Other Tools

```bash
# Count pages in multiple PDFs
for pdf in *.pdf; do
    pages=$(lankir pdf info "$pdf" --json | jq '.pageCount')
    echo "$pdf: $pages pages"
done

# Find signed PDFs
for pdf in *.pdf; do
    if lankir sign verify "$pdf" --json 2>/dev/null | jq -e '.[0]' > /dev/null; then
        echo "$pdf is signed"
    fi
done
```

### Error Handling

```bash
#!/bin/bash
set -e

lankir sign pdf input.pdf output.pdf --cert "$CERT" || {
    echo "Signing failed" >&2
    exit 1
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LANKIR_CONFIG_DIR` | Override config directory |
| `LANKIR_DEBUG` | Enable debug mode (`1` or `true`) |

## Next Steps

- [PDF Commands](pdf-commands.md) - File operations
- [Certificate Commands](cert-commands.md) - Certificate management
- [Sign Commands](sign-commands.md) - Signing and verification
- [Config Commands](config-commands.md) - Configuration
