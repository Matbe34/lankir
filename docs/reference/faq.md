# Frequently Asked Questions

## General

### What is Lankir?

Lankir is a desktop PDF viewer and signing tool for Linux. It supports viewing PDFs and signing them with digital certificates from various sources including hardware tokens (smart cards), certificate files, and browser certificate stores.

### Is Lankir free?

Yes, Lankir is open source and free to use.

### What operating systems are supported?

Currently, Lankir supports **Linux only** (x86_64). Support for macOS and Windows may be added in future versions.

### Does Lankir require an internet connection?

No. All core functionality works offline. The only feature that uses the network is optional geolocation for signature location metadata.

---

## PDF Viewing

### What PDF features are supported?

- Page viewing and navigation
- Zoom and scroll
- Thumbnail sidebar
- Page rendering with annotations
- PDF metadata viewing

### Can I edit PDFs?

Lankir is primarily a viewer and signing tool. Full PDF editing (text modification, page manipulation) is not currently supported.

### Why are some PDFs slow to render?

Large pages or complex graphics take more time to render. Try:
- Reducing zoom level
- Waiting for the page cache to warm up
- Disabling hardware acceleration if experiencing issues

### Are password-protected PDFs supported?

Not currently. Support for encrypted PDFs is planned for a future release.

---

## Digital Signatures

### What signature types are supported?

- **PKCS#12** (.p12, .pfx files) - Certificate + private key bundles
- **PKCS#11** - Hardware tokens (smart cards, USB tokens, HSMs)
- **NSS** - Firefox and Chrome certificate databases

### Do I need a certificate from a CA?

For personal use, self-signed certificates work fine. For legally binding signatures or documents that must be validated by others, you'll want a certificate from a recognized Certificate Authority.

### What's the difference between visible and invisible signatures?

- **Invisible signatures** add cryptographic signature data without changing the document's appearance
- **Visible signatures** display a signature box on the page showing signer info, date, etc.

### Can a PDF have multiple signatures?

Yes. Multiple people can sign the same PDF, and each signature is independent and verifiable.

### What happens if a document is modified after signing?

The signature becomes invalid. This is the primary purpose of digital signatures—to detect tampering.

### Why does Adobe Reader show my signature as "unknown"?

Adobe Reader only trusts signatures from certificates in its own trust store. To fix:
1. Add your certificate's CA to Adobe's trusted certificates
2. Or use a certificate from a CA that Adobe already trusts

---

## Hardware Tokens

### What hardware tokens are supported?

Any token with a PKCS#11 driver should work, including:
- Smart cards (via PC/SC readers)
- USB tokens (YubiKey, SafeNet, etc.)
- HSMs

### How do I set up my smart card?

1. Install PC/SC daemon: `sudo apt install pcscd`
2. Start the service: `sudo systemctl enable --now pcscd`
3. Insert your smart card
4. Run `lankir cert list` to see certificates

### Why isn't my token detected?

Check:
1. pcscd service is running: `sudo systemctl status pcscd`
2. Token is physically connected
3. PKCS#11 module path is correct in config
4. Try `pcsc_scan` to verify card detection

### What if I enter the wrong PIN?

Hardware tokens typically lock after 3-5 incorrect PIN attempts. Consult your token's documentation for unlock procedures.

---

## Certificates

### Where should I put my certificate files?

Place `.p12` or `.pfx` files in one of these locations:
- `~/.pki/nssdb/` (default user directory)
- Any directory added to `certificateStores` in config

### How do I create a test certificate?

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=Test User"

# Package as PKCS#12
openssl pkcs12 -export \
  -in cert.pem -inkey key.pem \
  -out test.p12
```

### How long are certificates valid?

Depends on how they were created. Check validity with:
```bash
lankir cert list | grep -A3 "Valid"
```

### Can I use my browser's certificates?

Yes! Lankir reads from Firefox and Chrome NSS databases automatically.

---

## CLI

### Can I automate signing?

Yes, the CLI supports batch operations:
```bash
for pdf in *.pdf; do
    lankir sign pdf "$pdf" "signed_$pdf" --cert ABC123... --pin "$PIN"
done
```

### How do I get JSON output?

Add `--json` to most commands:
```bash
lankir cert list --json
lankir sign verify document.pdf --json
```

### What's the exit code for verification?

- `0`: Document has signatures
- `1`: Error or no signatures

---

## Troubleshooting

### The app won't start

1. Make AppImage executable: `chmod +x lankir-*.AppImage`
2. Install FUSE: `sudo apt install libfuse2`
3. Check GTK3: `sudo apt install libgtk-3-0`

### Signing fails with no error

Enable debug mode:
```bash
lankir --verbose sign pdf doc.pdf out.pdf --cert ABC123...
```

### How do I reset all settings?

```bash
lankir config reset
# Or delete the config directory
rm -rf ~/.config/lankir/
```

---

## Development

### Can I contribute?

Yes! See the [Contributing Guide](../development/contributing.md).

### How do I build from source?

See the [Development Setup](../development/setup.md) guide.

### What technologies does Lankir use?

- **Backend**: Go, Wails v2, MuPDF
- **Frontend**: Vanilla JavaScript, Tailwind CSS
- **Signing**: digitorus/pdfsign

---

## Security

### Are my certificates secure?

- Certificate files are never modified
- PINs are only held in memory during signing
- Hardware token keys never leave the device
- No data is transmitted over the network (except optional geolocation)

### Is the source code audited?

Lankir is open source. Community review is welcome, but no formal security audit has been conducted.

### How are PINs handled?

- PINs are passed to the signing backend
- They are not logged or persisted
- Memory is cleared after signing completes

---

## Support

### Where can I get help?

- **Documentation**: You're reading it!
- **GitHub Issues**: Report bugs and request features
- **GitHub Discussions**: Ask questions

### How do I report a security issue?

For security vulnerabilities, please email the maintainers directly rather than opening a public issue.
