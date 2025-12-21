# Lankir Documentation

This directory contains the source files for Lankir's documentation, built with [Sphinx](https://www.sphinx-doc.org/) and hosted on [Read the Docs](https://readthedocs.org/).

## Quick Start

### Prerequisites

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Build HTML

```bash
# Build documentation
make html

# View in browser
xdg-open _build/html/index.html
# or
open _build/html/index.html  # macOS
```

### Live Preview (Recommended for Development)

```bash
# Auto-rebuild on changes and serve locally
make livehtml

# Opens at http://127.0.0.1:8000
```

## Structure

```
docs/
├── conf.py                 # Sphinx configuration
├── index.md                # Documentation home page
├── requirements.txt        # Python dependencies
├── Makefile                # Build commands
├── README.md               # This file
│
├── getting-started/        # Installation and first steps
│   ├── installation.md
│   ├── quick-start.md
│   └── configuration.md
│
├── user-guide/             # Feature documentation
│   ├── viewing-pdfs.md
│   ├── signing.md
│   ├── certificates.md
│   ├── signature-profiles.md
│   └── verification.md
│
├── cli/                    # Command-line reference
│   ├── overview.md
│   ├── pdf-commands.md
│   ├── cert-commands.md
│   ├── sign-commands.md
│   └── config-commands.md
│
├── architecture/           # Technical deep-dives
│   ├── overview.md
│   ├── backend.md
│   ├── frontend.md
│   ├── signature-system.md
│   └── wails-integration.md
│
├── development/            # Contributor guides
│   ├── setup.md
│   ├── building.md
│   ├── testing.md
│   └── contributing.md
│
├── reference/              # API and config reference
│   ├── api.md
│   ├── configuration.md
│   ├── troubleshooting.md
│   └── faq.md
│
└── _static/                # Images and assets
    ├── logo.png            # Required: 512×512 PNG
    ├── favicon.ico         # Required: 32×32 ICO
    ├── screenshot.png      # Required: 1200×800 PNG
    └── screenshots/        # Page-specific screenshots
```

## Writing Documentation

### Format

All documentation uses **Markdown** with [MyST](https://myst-parser.readthedocs.io/) extensions for Sphinx compatibility.

### MyST Syntax Highlights

```markdown
# Admonitions
:::{note}
This is a note.
:::

:::{warning}
This is a warning.
:::

:::{tip}
This is a tip.
:::

# Figures with captions
:::{figure} ../_static/screenshots/example.png
:alt: Alt text for accessibility
:width: 80%

*Caption text below the image*
:::

# Grid cards
::::{grid} 2
:gutter: 3

:::{grid-item-card} Card Title
:link: path/to/page
:link-type: doc

Card description
:::

::::
```

### Conventions

1. **Headers**: Use ATX-style (`#`, `##`, `###`)
2. **Code blocks**: Always specify language (```bash, ```go, ```javascript)
3. **Links**: Use relative paths for internal links
4. **Screenshots**: Add `{note}` blocks with screenshot specifications

### Adding New Pages

1. Create `.md` file in the appropriate section
2. Add to parent toctree in `index.md`
3. Run `make html` to verify
4. Commit both the new page and updated toctree

## Screenshots

Screenshots are referenced throughout the documentation. See `_static/README.md` for:
- Complete list of required screenshots
- Size specifications
- Capture guidelines
- Placeholder creation commands

### Quick Screenshot Checklist

- [ ] `_static/logo.png` (512×512)
- [ ] `_static/favicon.ico` (32×32)
- [ ] `_static/screenshot.png` (1200×800)
- [ ] `_static/screenshots/main-window.png`
- [ ] `_static/screenshots/pdf-open.png`
- [ ] `_static/screenshots/sign-dialog.png`
- [ ] ... (see full list in `_static/README.md`)

## Read the Docs Integration

The `.readthedocs.yaml` file in the project root configures RTD builds.

### Setting Up RTD

1. Push documentation to GitHub
2. Import project at [readthedocs.org/dashboard/import](https://readthedocs.org/dashboard/import/)
3. Configure webhook for automatic builds
4. Documentation will be available at `https://lankir.readthedocs.io/`

### Build Configuration

RTD uses:
- Python 3.11
- Sphinx with MyST
- Read the Docs theme
- HTML output only

## Troubleshooting

### Build Errors

```bash
# Clean build directory
make clean

# Rebuild
make html
```

### Missing Dependencies

```bash
# Reinstall all dependencies
pip install -r requirements.txt --force-reinstall
```

### MyST Syntax Errors

Check for:
- Unmatched `:::` or `::::`
- Missing blank lines before/after directives
- Incorrect indentation in directives

## Contributing

See [Contributing Guide](development/contributing.md) for documentation contribution guidelines.

When contributing documentation:
1. Follow the existing format and style
2. Add screenshots where helpful
3. Test builds locally before submitting
4. Update the toctree if adding new pages
