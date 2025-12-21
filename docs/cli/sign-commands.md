# Sign Commands

Commands for signing PDFs and verifying signatures.

## sign pdf

Sign a PDF document with a digital certificate.

```bash
lankir sign pdf <input-pdf> <output-pdf> [options]
```

### Certificate Selection (one required)

| Option | Description |
|--------|-------------|
| `--fingerprint`, `--cert` | Certificate SHA-256 fingerprint |
| `--name` | Search by certificate name |
| `--file` | Path to PKCS#12 file |

### Authentication

| Option | Description |
|--------|-------------|
| `--pin` | PIN or password (prompts if not provided) |

### Visible Signature Options

| Option | Default | Description |
|--------|---------|-------------|
| `--visible` | false | Create visible signature |
| `--page` | 1 | Page number for signature |
| `--x` | 400 | X position (points from left) |
| `--y` | 50 | Y position (points from bottom) |
| `--width` | 200 | Signature width (points) |
| `--height` | 80 | Signature height (points) |

### Profile Option

| Option | Description |
|--------|-------------|
| `--profile` | Signature profile UUID |

### Examples

```bash
# Sign with certificate fingerprint (invisible signature)
lankir sign pdf input.pdf output.pdf --fingerprint a1b2c3d4e5f6...

# Sign with PKCS#12 file
lankir sign pdf input.pdf output.pdf --file ~/certs/mycert.p12 --pin "password"

# Sign by certificate name (searches)
lankir sign pdf input.pdf output.pdf --name "John Doe"

# Create visible signature
lankir sign pdf input.pdf output.pdf \
    --fingerprint a1b2c3d4... \
    --visible \
    --page 1 \
    --x 400 --y 50 \
    --width 200 --height 80

# Sign with specific profile
lankir sign pdf input.pdf output.pdf \
    --fingerprint a1b2c3d4... \
    --profile "00000000-0000-0000-0000-000000000002"
```

### Output

```
Successfully signed PDF: output.pdf
```

## sign verify

Verify digital signatures in a PDF document.

```bash
lankir sign verify <pdf-file> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Verify signatures
lankir sign verify document.pdf

# Output:
Signature Verification Results:

Signature 1:
  Signer:           John Doe
  Signing Time:     2025-01-15 14:30:00 UTC
  Status:           ✓ Valid
  Document:         Not modified since signing
  Certificate:      Valid and trusted

Overall: Document has valid signatures

# JSON output
lankir sign verify document.pdf --json
```

### JSON Output

```json
[
  {
    "signerName": "John Doe",
    "signerDN": "CN=John Doe, O=Example Corp",
    "signingTime": "2025-01-15T14:30:00Z",
    "signatureType": "SHA256withRSA",
    "signingHashAlgorithm": "RSA",
    "isValid": true,
    "certificateValid": true,
    "validationMessage": "Signature is cryptographically valid",
    "certificateValidationMessage": "Certificate is valid and trusted",
    "reason": "",
    "location": "",
    "contactInfo": ""
  }
]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Document is signed (signatures found) |
| 1 | Error or no signatures |

## sign profiles list

List available signature profiles.

```bash
lankir sign profiles list [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
lankir sign profiles list

# Output:
Available Signature Profiles:

Profile 1:
  ID:          00000000-0000-0000-0000-000000000001
  Name:        Invisible Signature
  Description: Digital signature without visible appearance
  Visibility:  invisible
  Default:     true

Profile 2:
  ID:          00000000-0000-0000-0000-000000000002
  Name:        Visible Signature
  Description: Visible signature with signer name and timestamp
  Visibility:  visible
  Position:    Page 0, (360, 50), 200x80
  Default:     false
```

## Scripting Examples

### Batch Sign PDFs

```bash
#!/bin/bash
CERT="a1b2c3d4e5f6..."
PIN="your-pin"
INPUT_DIR="./unsigned"
OUTPUT_DIR="./signed"

mkdir -p "$OUTPUT_DIR"

for pdf in "$INPUT_DIR"/*.pdf; do
    filename=$(basename "$pdf")
    echo "Signing $filename..."
    lankir sign pdf "$pdf" "$OUTPUT_DIR/$filename" \
        --fingerprint "$CERT" \
        --pin "$PIN"
done

echo "Done! Signed $(ls "$OUTPUT_DIR"/*.pdf | wc -l) files"
```

### Verify and Report

```bash
#!/bin/bash
# Generate signature report
echo "PDF Signature Report - $(date)"
echo "================================"

for pdf in *.pdf; do
    echo ""
    echo "File: $pdf"
    
    result=$(lankir sign verify "$pdf" --json 2>/dev/null)
    
    if [ -z "$result" ] || [ "$result" = "[]" ]; then
        echo "  Status: Not signed"
    else
        count=$(echo "$result" | jq 'length')
        valid=$(echo "$result" | jq '[.[] | select(.isValid == true)] | length')
        echo "  Signatures: $count"
        echo "  Valid: $valid"
        
        echo "$result" | jq -r '.[] | "  - \(.signerName): \(if .isValid then "✓" else "✗" end)"'
    fi
done
```

### Sign with Timestamp

```bash
#!/bin/bash
# Sign with visible timestamp
lankir sign pdf "$1" "${1%.pdf}_signed.pdf" \
    --fingerprint "$CERT_FINGERPRINT" \
    --visible \
    --page 1 \
    --x 350 --y 700
```

### Interactive Signing

```bash
#!/bin/bash
# Interactive certificate selection
echo "Available certificates:"
lankir cert list --valid-only

echo ""
read -p "Enter certificate fingerprint: " cert
read -sp "Enter PIN: " pin
echo ""

lankir sign pdf "$1" "${1%.pdf}_signed.pdf" \
    --fingerprint "$cert" \
    --pin "$pin"
```

### Verify Before Processing

```bash
#!/bin/bash
# Only process signed documents
process_document() {
    local pdf=$1
    # Your processing logic here
    echo "Processing: $pdf"
}

for pdf in *.pdf; do
    if lankir sign verify "$pdf" --json 2>/dev/null | jq -e '.[0].isValid' > /dev/null; then
        process_document "$pdf"
    else
        echo "Skipping unsigned/invalid: $pdf"
    fi
done
```

## Error Messages

### Certificate Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "certificate not found" | Invalid fingerprint or name | Run `lankir cert list` to verify |
| "certificate cannot sign" | Missing key usage | Use different certificate |
| "certificate expired" | Validity period ended | Renew certificate |

### PIN Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "invalid PIN" | Wrong password/PIN | Verify and retry |
| "PIN required" | Token needs authentication | Provide `--pin` option |

### File Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "input file not found" | PDF doesn't exist | Check path |
| "failed to open PDF" | Corrupted or invalid PDF | Verify file integrity |
| "permission denied" | Can't write output | Check directory permissions |

## Security Notes

### PIN Handling

- Avoid passing PINs on command line (visible in process list)
- Use environment variables for automation:
  ```bash
  export PDF_SIGN_PIN="password"
  lankir sign pdf in.pdf out.pdf --cert ABC... --pin "$PDF_SIGN_PIN"
  ```
- Or let the tool prompt interactively

### Logging

With `--verbose`, sensitive data is redacted:
```bash
lankir --verbose sign pdf doc.pdf out.pdf --cert ABC...
# PIN values are not logged
```

## Next Steps

- [Config Commands](config-commands.md) - Configuration management
- [User Guide: Signing](../user-guide/signing.md) - Detailed signing guide
