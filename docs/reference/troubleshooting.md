# Troubleshooting

Common issues and solutions for PDF App.

## Installation Issues

### AppImage Won't Run

**Symptoms:** Double-clicking does nothing, or "cannot execute" error.

**Solutions:**

1. Make it executable:
   ```bash
   chmod +x pdf-app-*.AppImage
   ```

2. Install FUSE (required for AppImages):
   ```bash
   sudo apt install libfuse2  # Ubuntu 22.04+
   sudo apt install fuse      # Older Ubuntu
   ```

3. Run from terminal to see errors:
   ```bash
   ./pdf-app-*.AppImage
   ```

### Missing Libraries

**Symptoms:** "error while loading shared libraries"

**Solutions:**

For GTK errors:
```bash
sudo apt install libgtk-3-0
```

For WebKit errors:
```bash
sudo apt install libwebkit2gtk-4.0-37
```

## Certificate Issues

### No Certificates Found

**Symptoms:** Certificate list is empty.

**Causes & Solutions:**

1. **No certificate stores configured**
   ```bash
   pdf-app config get certificateStores
   # If empty, add paths:
   # Edit ~/.config/pdf_app/config.json
   ```

2. **Certificate files not in expected location**
   - Place `.p12`/`.pfx` files in `~/.pki/nssdb/`
   - Or add your directory to `certificateStores`

3. **PKCS#11 token not connected**
   ```bash
   # Check if token is visible
   pkcs11-tool --list-slots
   
   # Check pcscd service
   sudo systemctl status pcscd
   ```

### Certificate Not Valid for Signing

**Symptoms:** "certificate cannot sign" error

**Cause:** Certificate lacks Digital Signature key usage.

**Solution:** 
```bash
# Check certificate capabilities
pdf-app cert list | grep -A5 "Name: YourCert"
# Look for "Can Sign: true"

# Or with openssl
openssl x509 -in cert.pem -text | grep -A2 "Key Usage"
```

### Wrong PIN / Invalid Password

**Symptoms:** "invalid PIN" or "incorrect password"

**For PKCS#12 files:**
- The password is the file's encryption password
- Try the password you set when exporting the certificate

**For PKCS#11 tokens:**
- Default PINs vary by token (often `123456` for testing)
- Check token documentation
- Warning: Tokens may lock after 3-5 failed attempts

### Token Not Detected

**Symptoms:** PKCS#11 certificates don't appear

1. **Check pcscd service:**
   ```bash
   sudo systemctl start pcscd
   sudo systemctl enable pcscd
   ```

2. **Verify token is recognized:**
   ```bash
   pcsc_scan
   # Should show your card/token
   ```

3. **Check module path:**
   ```bash
   pdf-app config get tokenLibraries
   ls -la /usr/lib/x86_64-linux-gnu/pkcs11/
   ```

## Signing Issues

### Signing Fails Silently

**Enable debug mode for details:**
```bash
pdf-app --verbose sign pdf input.pdf output.pdf --cert ABC123...
```

### "Certificate does not have associated file path"

**Cause:** Trying to sign with a certificate that has no accessible private key.

**Solution:** Use a PKCS#12 file or PKCS#11 token with private key access.

### Signed PDF Invalid in Adobe Reader

**Possible causes:**

1. **Self-signed certificate** - Adobe doesn't trust it
   - Add your CA to Adobe's trust store
   - Or use a publicly trusted certificate

2. **Missing certificate chain** - Intermediate CA not included
   - Ensure your PKCS#12 includes the full chain

## PDF Viewing Issues

### PDF Won't Open

**Symptoms:** "failed to open PDF" error

**Solutions:**

1. Check file exists and is readable:
   ```bash
   ls -la document.pdf
   ```

2. Verify it's a valid PDF:
   ```bash
   file document.pdf
   # Should show "PDF document"
   ```

3. Try with another PDF viewer to confirm file isn't corrupted

### Slow Rendering

**Symptoms:** Pages take long to display

**Solutions:**

1. **Reduce zoom level** - Lower zoom = less data to render

2. **Disable hardware acceleration:**
   ```bash
   pdf-app config set hardwareAccel false
   ```

3. **Check system resources:**
   ```bash
   htop  # Check CPU/memory usage
   ```

### Blank Pages

**Symptoms:** Pages render as white/empty

**Solutions:**

1. Wait a moment - large pages take time
2. Try different zoom level
3. Check PDF isn't password-protected
4. Restart application

## Configuration Issues

### Config File Corrupted

**Symptoms:** App crashes on start, or settings don't work

**Solution:** Reset configuration:
```bash
# Backup current (if needed)
cp ~/.config/pdf_app/config.json ~/.config/pdf_app/config.json.bak

# Delete and let app recreate
rm ~/.config/pdf_app/config.json

# Or reset via CLI
pdf-app config reset
```

### Settings Not Persisting

**Cause:** Permission issues or disk full

**Check:**
```bash
# Verify directory permissions
ls -la ~/.config/pdf_app/

# Check disk space
df -h ~
```

## Performance Issues

### High Memory Usage

**For large PDFs:**
- Memory usage is proportional to page size × zoom
- Close PDFs when not needed
- Reduce zoom level

**Memory leak (unlikely but possible):**
- Restart application
- Report issue with reproduction steps

### Application Freezes

**During signing:**
- Hardware tokens can be slow - wait for completion
- Check token LED for activity

**During rendering:**
- Large pages at high zoom take time
- Check if MuPDF process is active

## Debug Mode

Enable detailed logging:

```bash
# Via config
pdf-app config set debugMode true

# Via command line
pdf-app --verbose <command>

# Via environment
PDF_APP_DEBUG=1 pdf-app
```

## Getting Help

### Collect Diagnostic Information

```bash
# System info
uname -a
cat /etc/os-release

# App info
pdf-app --version

# Configuration
pdf-app config get --json

# Certificate sources
pdf-app cert list --json 2>&1 | head -50
```

### Reporting Issues

When opening a GitHub issue, include:

1. **OS and version** (Ubuntu 22.04, Fedora 39, etc.)
2. **PDF App version** (`pdf-app --version`)
3. **Steps to reproduce**
4. **Expected behavior**
5. **Actual behavior**
6. **Debug output** (with `--verbose`)
7. **Screenshots** if UI-related

---

## See Also

- [FAQ](faq.md) - Frequently asked questions
- [Configuration Reference](configuration.md) - All settings
- [Development Setup](../development/setup.md) - For advanced debugging
