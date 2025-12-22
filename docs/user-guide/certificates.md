# Certificate Management

Lankir aggregates certificates from multiple sources for signing PDFs.

```{figure} ../_static/screenshots/certificate-list.png
:alt: Certificate management interface
:width: 100%

*Certificate list showing certificates from multiple sources*
```

## Certificate Sources

### PKCS#12 Files (.p12, .pfx)

Personal certificate files containing both the certificate and private key, protected by a password.

**Default search locations:**
- `/etc/ssl/certs` (system)
- `~/.pki/nssdb` (user)

**Adding custom directories:**
```bash
# View current stores
lankir config get certificateStores

# Add a directory (must be absolute path in allowed locations)
# Edit ~/.config/lankir/config.json directly
```

### PKCS#11 (Hardware Tokens)

Smart cards, USB tokens, and HSMs accessed via PKCS#11 modules.

**Auto-detected modules:**
- `/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so` (p11-kit proxy)
- `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so` (OpenSC)

**Adding custom modules:**
```bash
# View current modules
lankir config get tokenLibraries

# Modules must have .so extension and exist on the filesystem
```

### NSS Database (Firefox/Chrome)

Lankir reads certificates from browser certificate stores:
- `~/.mozilla/firefox/*/cert9.db`
- `~/.pki/nssdb/cert9.db`

These are automatically discovered—no configuration needed.

## Listing Certificates

### All Certificates

```bash
lankir cert list

# Output:
# Found 3 certificate(s):
#
# Certificate 1:
#   Name:          John Doe
#   Subject:       John Doe
#   Issuer:        Example CA
#   Valid From:    2024-01-01 00:00:00
#   Valid To:      2025-12-31 23:59:59
#   Fingerprint:   a1b2c3d4e5f6...
#   Source:        pkcs12
#   Valid:         true
#   Can Sign:      true
```

### Filtered Lists

```bash
# Only valid (non-expired) certificates
lankir cert list --valid-only

# Filter by source
lankir cert list --source pkcs11
lankir cert list --source pkcs12
lankir cert list --source nss

# Search by name/subject/issuer
lankir cert search "john"

# JSON output
lankir cert list --json
```

### Show All Details

By default, only the first 20 certificates are shown:

```bash
# Show all certificates
lankir cert list --all
```

## Certificate Properties

| Property | Description |
|----------|-------------|
| `name` | Common name or filename |
| `subject` | Certificate subject DN |
| `issuer` | Issuer's common name |
| `serialNumber` | Unique serial number |
| `validFrom` | Start of validity period |
| `validTo` | End of validity period |
| `fingerprint` | SHA-256 hash (unique identifier) |
| `source` | Where certificate was found |
| `keyUsage` | Allowed operations |
| `isValid` | Currently within validity period |
| `canSign` | Has digital signature capability |
| `requiresPin` | PIN needed for signing |
| `filePath` | File location (for PKCS#12) |
| `pkcs11Module` | Module path (for PKCS#11) |

## Certificate Requirements

For signing PDFs, certificates must have:

1. **Digital Signature key usage** - The certificate must allow signing
2. **Valid dates** - Current time within NotBefore and NotAfter
3. **Private key access** - Either embedded (PKCS#12) or accessible (PKCS#11)

Check signing capability:
```bash
lankir cert list --valid-only | grep "Can Sign"
```

## PKCS#12 Certificate Files

### Creating a Self-Signed Certificate

For testing purposes:

```bash
# Generate private key and certificate
openssl req -x509 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=Test User/O=Test Org"

# Package as PKCS#12
openssl pkcs12 -export \
  -in cert.pem -inkey key.pem \
  -out test.p12 -name "Test Certificate"
```

### Importing Certificates

Place `.p12` or `.pfx` files in a configured certificate store directory:

```bash
# Copy to user certificate directory
cp mycert.p12 ~/.pki/nssdb/
```

Or add your certificate directory to the configuration.

## Hardware Token Setup

### Smart Card Readers

1. Install PC/SC daemon:
   ```bash
   sudo apt install pcscd pcsc-tools  # Debian/Ubuntu
   ```

2. Start service:
   ```bash
   sudo systemctl enable --now pcscd
   ```

3. Verify card detection:
   ```bash
   pcsc_scan
   ```

### Common PKCS#11 Modules

| Token Type | Module Path |
|------------|-------------|
| Generic (p11-kit) | `/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so` |
| OpenSC (most cards) | `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so` |
| YubiKey | `/usr/lib/x86_64-linux-gnu/libykcs11.so` |
| SafeNet | `/usr/lib/libeToken.so` |
| SoftHSM (testing) | `/usr/lib/softhsm/libsofthsm2.so` |

### Testing PKCS#11 Access

```bash
# List slots with p11tool
p11tool --list-tokens

# List certificates on token
p11tool --list-all-certs "pkcs11:token=MyToken"
```

## Browser Certificate Import

### From Firefox

Firefox certificates are automatically detected. To manually export:

1. Firefox → Preferences → Privacy & Security → Certificates → View Certificates
2. Your Certificates tab → Select certificate → Backup
3. Save as `.p12` file

### From Chrome

Chrome uses the NSS database in `~/.pki/nssdb/`:

```bash
# List certificates in Chrome's NSS database
certutil -d sql:$HOME/.pki/nssdb -L

# Export a certificate
pk12util -d sql:$HOME/.pki/nssdb -o output.p12 -n "Certificate Name"
```

## Troubleshooting

### Certificate Not Showing

1. Check source is configured:
   ```bash
   lankir config get certificateStores
   lankir config get tokenLibraries
   ```

2. Verify file permissions:
   ```bash
   ls -la ~/.pki/nssdb/
   ```

3. For PKCS#11, check service:
   ```bash
   sudo systemctl status pcscd
   ```

### "Certificate cannot sign"

The certificate lacks digital signature key usage:
```bash
# Check key usage
openssl x509 -in cert.pem -text | grep -A1 "Key Usage"
```

### Wrong Password

- PKCS#12: The password protects the file
- PKCS#11: The PIN protects the token
- NSS: May require the master password

### Certificate Expired

Check validity:
```bash
lankir cert list | grep -A2 "Valid"
```

Renew your certificate with your certificate authority.

## Security Best Practices

1. **Protect PKCS#12 files** - Use strong passwords, restrict file permissions
2. **Hardware tokens preferred** - Private keys never leave the device
3. **Regular rotation** - Renew certificates before expiration
4. **Audit certificate usage** - Monitor which certificates are used

## Next Steps

- [Signing PDFs](signing.md) - Use certificates for signing
- [Signature Profiles](signature-profiles.md) - Configure signature appearance
