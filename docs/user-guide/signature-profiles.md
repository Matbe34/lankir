# Signature Profiles

Signature profiles define the appearance and settings for visible signatures.

```{figure} ../_static/screenshots/signature-profile-editor.png
:alt: Signature profile editor
:width: 80%
:align: center

*Creating a custom signature profile with logo and positioning options*
```

```{note}
**Screenshot needed:** `_static/screenshots/signature-profile-editor.png` — The profile editor dialog showing visibility options, position settings, and appearance configuration.
```

## Overview

A signature profile controls:
- **Visibility**: Invisible (cryptographic only) or visible (appears on page)
- **Position**: Where the signature appears (page, coordinates)
- **Appearance**: What the signature box displays (name, date, logo)

## Built-in Profiles

PDF App includes two default profiles:

### Invisible Signature
- **ID**: `00000000-0000-0000-0000-000000000001`
- **Description**: Cryptographic signature with no visual appearance
- **Use case**: Documents where layout shouldn't change

### Visible Signature
- **ID**: `00000000-0000-0000-0000-000000000002`
- **Description**: Signature box showing signer name and timestamp
- **Position**: Bottom-right of last page
- **Size**: 200×80 points

## Listing Profiles

```bash
pdf-app sign profiles list

# JSON output
pdf-app sign profiles list --json
```

## Using Profiles

### In GUI

1. Click **Sign** in the toolbar
2. Select certificate
3. Choose profile from **Signature Profile** dropdown
4. For visible signatures, optionally adjust position by clicking on the page

### In CLI

```bash
# Use default profile (invisible)
pdf-app sign pdf doc.pdf out.pdf --cert ABC123...

# Use visible signature profile
pdf-app sign pdf doc.pdf out.pdf \
    --cert ABC123... \
    --profile "00000000-0000-0000-0000-000000000002"

# Override position for visible signature
pdf-app sign pdf doc.pdf out.pdf \
    --cert ABC123... \
    --visible \
    --page 1 \
    --x 400 --y 50
```

## Profile Settings

### Visibility Options

| Value | Description |
|-------|-------------|
| `invisible` | No visual appearance on document |
| `visible` | Signature box appears on specified page |

### Position Settings

| Setting | Type | Description |
|---------|------|-------------|
| `page` | int | Page number (1-indexed, 0 = last page) |
| `x` | float | Horizontal position from left edge (points) |
| `y` | float | Vertical position from bottom edge (points) |
| `width` | float | Signature box width (points) |
| `height` | float | Signature box height (points) |

:::{note}
PDF coordinates start from the bottom-left corner. 1 inch = 72 points.
:::

### Appearance Settings

| Setting | Type | Description |
|---------|------|-------------|
| `showSignerName` | bool | Display the certificate holder's name |
| `showSigningTime` | bool | Display date and time of signing |
| `showLocation` | bool | Display geographic location (if available) |
| `showLogo` | bool | Display a custom logo image |
| `logoPath` | string | Base64 data URL of logo image |
| `logoPosition` | string | Logo placement: `"left"` or `"top"` |
| `customText` | string | Additional text to display |
| `fontSize` | int | Text size in points |

## Profile Storage

Profiles are stored as JSON files in:
```
~/.config/pdf_app/signature_profiles/
```

Each profile is a separate file named `{uuid}.json`.

## Profile JSON Structure

```json
{
  "id": "12345678-1234-1234-1234-123456789012",
  "name": "Company Signature",
  "description": "Standard company signature with logo",
  "visibility": "visible",
  "isDefault": false,
  "position": {
    "page": 0,
    "x": 360,
    "y": 50,
    "width": 200,
    "height": 80
  },
  "appearance": {
    "showSignerName": true,
    "showSigningTime": true,
    "showLocation": false,
    "showLogo": true,
    "logoPath": "data:image/png;base64,iVBORw0KGgo...",
    "logoPosition": "left",
    "customText": "Approved for release",
    "fontSize": 10
  }
}
```

## Creating Custom Profiles

### Via GUI

1. Go to **Settings → Signature Profiles**
2. Click **New Profile**
3. Configure settings:
   - Name and description
   - Visibility (invisible/visible)
   - Position (page, coordinates, size)
   - Appearance options
4. Click **Save**

### Via File

Create a JSON file in `~/.config/pdf_app/signature_profiles/`:

```bash
cat > ~/.config/pdf_app/signature_profiles/my-profile.json << 'EOF'
{
  "id": "$(uuidgen)",
  "name": "My Custom Profile",
  "description": "Signature for internal documents",
  "visibility": "visible",
  "isDefault": false,
  "position": {
    "page": 1,
    "x": 72,
    "y": 72,
    "width": 200,
    "height": 60
  },
  "appearance": {
    "showSignerName": true,
    "showSigningTime": true,
    "showLocation": false,
    "showLogo": false,
    "customText": "",
    "fontSize": 10
  }
}
EOF
```

## Position Examples

### Bottom-Right Corner (Last Page)

```json
"position": {
  "page": 0,
  "x": 360,
  "y": 50,
  "width": 200,
  "height": 80
}
```

### Top-Right Corner (First Page)

```json
"position": {
  "page": 1,
  "x": 360,
  "y": 700,
  "width": 200,
  "height": 80
}
```

### Centered (Specific Page)

For a Letter-size page (612×792 points):
```json
"position": {
  "page": 3,
  "x": 206,
  "y": 356,
  "width": 200,
  "height": 80
}
```

## Logo Requirements

- **Formats**: PNG, JPEG, GIF
- **Recommended size**: 100-200 pixels wide
- **Encoding**: Base64 data URL

### Converting Logo to Base64

```bash
# Convert image to base64 data URL
echo "data:image/png;base64,$(base64 -w0 logo.png)"
```

### Logo Positioning

| Position | Description |
|----------|-------------|
| `left` | Logo on left, text on right |
| `top` | Logo above text |

## Best Practices

### Consistent Positioning

For multi-page documents signed by the same organization:
- Use the same profile for all signatures
- Position signatures consistently (same corner, same size)

### Readable Signatures

- Keep font size at 10+ points for readability
- Ensure adequate contrast with document background
- Leave margin from page edges

### Logo Usage

- Use transparent PNG for best results
- Keep logos simple and recognizable at small sizes
- Ensure logo doesn't overpower text information

## Troubleshooting

### Profile Not Appearing

Check profiles directory exists:
```bash
ls -la ~/.config/pdf_app/signature_profiles/
```

### Invalid Profile

Validate JSON syntax:
```bash
python3 -m json.tool ~/.config/pdf_app/signature_profiles/my-profile.json
```

Required fields:
- `id`: Valid UUID
- `name`: Non-empty string
- `visibility`: `"invisible"` or `"visible"`

### Signature Cut Off

Position too close to edge. Ensure:
- `x + width < page_width - margin`
- `y + height < page_height - margin`

## Next Steps

- [Signing PDFs](signing.md) - Use profiles when signing
- [Verification](verification.md) - Verify signed documents
