# Certificate Commands

Commands for managing digital certificates.

## cert list

List all available certificates from configured sources.

```bash
pdf-app cert list [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--source` | Filter by source: `pkcs12`, `pkcs11`, `nss` |
| `--valid-only` | Show only non-expired certificates |
| `--all` | Show all certificates (default: max 20) |
| `--json` | Output in JSON format |

### Examples

```bash
# List all certificates
pdf-app cert list

# Output:
Found 3 certificate(s):

Certificate 1:
  Name:          John Doe
  Subject:       John Doe
  Issuer:        Example CA
  Serial:        1234567890
  Valid From:    2024-01-01 00:00:00
  Valid To:      2025-12-31 23:59:59
  Fingerprint:   a1b2c3d4e5f6g7h8...
  Source:        pkcs12
  Valid:         true
  Can Sign:      true
  File Path:     /home/user/.pki/nssdb/cert.p12

# Filter by source
pdf-app cert list --source pkcs11

# Only valid certificates
pdf-app cert list --valid-only

# JSON output
pdf-app cert list --json
```

### JSON Output

```json
[
  {
    "name": "John Doe",
    "issuer": "Example CA",
    "subject": "John Doe",
    "serialNumber": "1234567890",
    "validFrom": "2024-01-01 00:00:00",
    "validTo": "2025-12-31 23:59:59",
    "fingerprint": "a1b2c3d4e5f6g7h8...",
    "source": "pkcs12",
    "keyUsage": ["Digital Signature", "Non Repudiation"],
    "isValid": true,
    "canSign": true,
    "requiresPin": true,
    "filePath": "/home/user/.pki/nssdb/cert.p12"
  }
]
```

## cert search

Search for certificates by name, subject, issuer, or serial number.

```bash
pdf-app cert search <query> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

### Examples

```bash
# Search by name
pdf-app cert search "john"

# Output:
Found 2 certificate(s) matching 'john':

Certificate 1:
  Name:          John Doe
  ...

Certificate 2:
  Name:          Johnny Smith
  ...

# Search by issuer
pdf-app cert search "DigiCert"

# JSON output
pdf-app cert search "john" --json
```

## Certificate Properties

### Understanding Certificate Fields

| Field | Description |
|-------|-------------|
| `name` | Common name or certificate friendly name |
| `subject` | Full subject distinguished name |
| `issuer` | Certificate authority that issued it |
| `serialNumber` | Unique serial number |
| `validFrom` | Start of validity period |
| `validTo` | End of validity period |
| `fingerprint` | SHA-256 hash (unique identifier) |
| `source` | Where certificate was found |
| `keyUsage` | Permitted operations |
| `isValid` | Currently within validity dates |
| `canSign` | Has digital signature capability |
| `requiresPin` | PIN/password needed |
| `pinOptional` | PIN optional (may prompt) |
| `filePath` | File location (PKCS#12) |
| `pkcs11Module` | Module path (PKCS#11) |
| `nssNickname` | NSS database nickname |

### Certificate Sources

| Source | Description |
|--------|-------------|
| `pkcs12` | PKCS#12 file (.p12, .pfx) |
| `pkcs11` | Hardware token via PKCS#11 |
| `User NSS DB` | User's NSS database |
| `NSS Database` | System NSS database |
| `system` | System certificate store |
| `user` | User certificate store |

### Key Usage

Certificates may have these key usages:
- **Digital Signature** - Can sign data
- **Non Repudiation** - Signature cannot be denied
- **Key Encipherment** - Can encrypt keys
- **Data Encipherment** - Can encrypt data

For PDF signing, **Digital Signature** is required.

## Scripting Examples

### Find Signing Certificates

```bash
#!/bin/bash
# List certificates that can sign PDFs
pdf-app cert list --valid-only --json | jq '.[] | select(.canSign == true) | .fingerprint'
```

### Check Certificate Expiry

```bash
#!/bin/bash
# Find certificates expiring within 30 days
pdf-app cert list --json | jq -r '.[] | 
  select(.isValid == true) | 
  "\(.name): expires \(.validTo)"'
```

### Export Certificate Info

```bash
#!/bin/bash
# Export certificate inventory to CSV
echo "Name,Fingerprint,Valid Until,Source,Can Sign"
pdf-app cert list --json | jq -r '.[] | 
  [.name, .fingerprint[0:16], .validTo, .source, .canSign] | 
  @csv'
```

### Find Certificate by Fingerprint

```bash
#!/bin/bash
fingerprint="a1b2c3d4"
cert=$(pdf-app cert list --json | jq ".[] | select(.fingerprint | startswith(\"$fingerprint\"))")
if [ -n "$cert" ]; then
    echo "Found: $(echo $cert | jq -r '.name')"
else
    echo "Certificate not found"
fi
```

### Check Hardware Token

```bash
#!/bin/bash
# Check if hardware token certificates are available
pkcs11_certs=$(pdf-app cert list --source pkcs11 --json | jq 'length')
if [ "$pkcs11_certs" -gt 0 ]; then
    echo "Found $pkcs11_certs certificate(s) on hardware token"
else
    echo "No hardware token certificates found"
    echo "Check: Is token connected? Is pcscd running?"
fi
```

## Troubleshooting

### No Certificates Found

```bash
# Check certificate store configuration
pdf-app config get certificateStores
pdf-app config get tokenLibraries

# Enable verbose logging
pdf-app --verbose cert list
```

### PKCS#11 Token Not Detected

```bash
# Check pcscd service
sudo systemctl status pcscd

# List PKCS#11 slots
pkcs11-tool --list-slots

# Verify module path
ls -la /usr/lib/x86_64-linux-gnu/pkcs11/
```

### Certificate Shows "Cannot Sign"

The certificate lacks digital signature key usage:

```bash
# View certificate details
openssl x509 -in cert.pem -text | grep -A2 "Key Usage"
```

Only certificates with `Digital Signature` key usage can sign PDFs.

## Next Steps

- [Sign Commands](sign-commands.md) - Use certificates for signing
- [User Guide: Certificates](../user-guide/certificates.md) - Certificate management
