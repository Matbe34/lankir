# Digital Signatures

Lankir supports signing PDFs with digital certificates from multiple sources, including hardware tokens.

```{figure} ../_static/screenshots/signing-workflow.png
:alt: Complete signing workflow
:width: 100%

*Signing a PDF document with a visible signature*
```

```{note}
**Screenshot needed:** `_static/screenshots/signing-workflow.png` — The application during a signing operation, showing a PDF with the signature dialog or a visible signature being placed.
```

## Certificate Sources

Lankir can use certificates from:

| Source | Description | PIN Required |
|--------|-------------|--------------|
| **PKCS#12** | `.p12` or `.pfx` files | Yes (file password) |
| **PKCS#11** | Hardware tokens (smart cards, USB) | Usually yes |
| **NSS** | Firefox/Chrome certificate database | Optional |

## Signing a PDF

### GUI Method

1. **Open a PDF** you want to sign
2. Click **Sign** in the toolbar
3. **Select certificate** from the dropdown
4. **Enter PIN** if prompted
5. Choose **signature profile** (invisible or visible)
6. Click **Sign Document**

```{figure} ../_static/screenshots/sign-button.png
:alt: Sign button in toolbar
:width: 60%
:align: center

*The Sign button in the application toolbar*
```

```{note}
**Screenshot needed:** `_static/screenshots/sign-button.png` — Close-up of the toolbar showing the Sign button.
```

The signed PDF is saved as `original_signed.pdf` in the same directory.

### CLI Method

```bash
# Sign with a specific certificate (by fingerprint)
lankir sign pdf input.pdf output.pdf --fingerprint ABC123...

# Sign with certificate file
lankir sign pdf input.pdf output.pdf --file /path/to/cert.p12 --pin "password"

# Sign with certificate by name (search)
lankir sign pdf input.pdf output.pdf --name "My Certificate"
```

## Invisible vs Visible Signatures

### Invisible Signatures

The default signature type. The PDF is cryptographically signed but no visual indicator appears on any page.

```bash
lankir sign pdf input.pdf output.pdf --cert ABC123...
```

Use cases:
- Documents where appearance shouldn't change
- Multiple signatures on one document
- Automated/batch signing

### Visible Signatures

A signature box appears on the PDF showing signing information.

```bash
lankir sign pdf input.pdf output.pdf --cert ABC123... \
  --visible \
  --page 1 \
  --x 400 --y 50 \
  --width 200 --height 80
```

```{figure} ../_static/screenshots/visible-signature.png
:alt: Visible signature on a PDF page
:width: 60%
:align: center

*A visible signature showing signer name, date, and optional logo*
```

```{note}
**Screenshot needed:** `_static/screenshots/visible-signature.png` — Close-up of a visible signature box on a PDF page, showing the signature appearance with name and timestamp.
```

Position parameters:
- `--page`: Page number (1-indexed)
- `--x`, `--y`: Position from bottom-left corner (in points)
- `--width`, `--height`: Signature box dimensions (in points)

:::{tip}
1 inch = 72 points. A Letter page is 612×792 points.
:::

## Using Hardware Tokens

### Smart Cards

1. Insert your smart card into the reader
2. Ensure `pcscd` service is running:
   ```bash
   sudo systemctl status pcscd
   ```
3. List available certificates:
   ```bash
   lankir cert list --source pkcs11
   ```
4. Sign with PIN:
   ```bash
   lankir sign pdf doc.pdf signed.pdf --fingerprint ABC123...
   # Enter PIN when prompted
   ```

### USB Tokens

USB tokens (like YubiKey, SafeNet) work the same way as smart cards through PKCS#11.

1. Connect your token
2. Install the vendor's PKCS#11 module if not auto-detected
3. Add custom module path if needed:
   ```bash
   # Edit config to add token library
   lankir config get tokenLibraries
   ```

## Certificate Selection

### By Fingerprint (Recommended)

The most precise method—use the SHA-256 fingerprint:

```bash
# List certificates with fingerprints
lankir cert list

# Sign with fingerprint
lankir sign pdf doc.pdf out.pdf --fingerprint a1b2c3d4e5f6...
```

### By Name

Search certificates by common name:

```bash
lankir sign pdf doc.pdf out.pdf --name "John Doe"
```

:::{warning}
If multiple certificates match, you'll be prompted to use the fingerprint instead.
:::

### By File Path

For PKCS#12 files:

```bash
lankir sign pdf doc.pdf out.pdf --file ~/certs/mycert.p12
```

## Batch Signing

Sign multiple PDFs with a script:

```bash
#!/bin/bash
CERT_FINGERPRINT="abc123..."
PIN="your-pin"

for pdf in *.pdf; do
    lankir sign pdf "$pdf" "signed_$pdf" \
        --fingerprint "$CERT_FINGERPRINT" \
        --pin "$PIN"
done
```

:::{warning}
Storing PINs in scripts is insecure. Consider using environment variables or a secrets manager for production use.
:::

## Signature Profiles

For consistent visible signatures, create and use profiles:

```bash
# List profiles
lankir sign profiles list

# Sign with specific profile
lankir sign pdf doc.pdf out.pdf \
    --cert ABC123... \
    --profile "00000000-0000-0000-0000-000000000002"
```

See [Signature Profiles](signature-profiles.md) for creating custom profiles.

## Signing Workflow Tips

### Single Signer

1. Open PDF
2. Sign with your certificate
3. Save and distribute

### Multiple Signers

PDFs can have multiple signatures. Each signer:
1. Opens the already-signed PDF
2. Adds their signature
3. Saves (signatures are additive)

### Timestamps

Signatures include the signing time from your system clock. For legally binding timestamps, consider using a Time Stamping Authority (TSA)—this feature is planned for future releases.

## Troubleshooting

### "Certificate not found"

- Verify certificate is installed: `lankir cert list`
- Check certificate store paths: `lankir config get certificateStores`
- For PKCS#11: Ensure token is connected and pcscd is running

### "Invalid PIN"

- PKCS#12: This is the file password, not a PIN
- PKCS#11: Check if PIN is required (`requiresPin` field)
- Some tokens lock after 3 failed attempts

### "Certificate cannot sign"

The certificate lacks digital signature key usage. Check:
```bash
lankir cert list --valid-only
```

Only certificates with `canSign: true` can sign documents.

### "Signing failed"

Check verbose output:
```bash
lankir --verbose sign pdf doc.pdf out.pdf --cert ABC123...
```

## Next Steps

- [Signature Profiles](signature-profiles.md) - Customize visible signatures
- [Verification](verification.md) - Verify signed documents
- [Certificates](certificates.md) - Manage certificate sources
