# Minimal makefile for Sphinx documentation

SPHINXOPTS    ?=
SPHINXBUILD   ?= sphinx-build
SOURCEDIR     = .
BUILDDIR      = _build

.PHONY: help clean html livehtml linkcheck

help:
	@echo "PDF App Documentation"
	@echo ""
	@echo "Usage:"
	@echo "  make html       Build HTML documentation"
	@echo "  make clean      Remove build artifacts"
	@echo "  make livehtml   Live preview with auto-rebuild"
	@echo "  make linkcheck  Check for broken links"
	@echo ""
	@echo "Prerequisites:"
	@echo "  pip install -r requirements.txt"

html:
	@$(SPHINXBUILD) -b html "$(SOURCEDIR)" "$(BUILDDIR)/html" $(SPHINXOPTS)
	@echo ""
	@echo "Build finished. Open $(BUILDDIR)/html/index.html"

clean:
	rm -rf $(BUILDDIR)

livehtml:
	@echo "Starting live preview at http://127.0.0.1:8000"
	sphinx-autobuild "$(SOURCEDIR)" "$(BUILDDIR)/html" $(SPHINXOPTS) --ignore "*.pyc" --ignore "__pycache__"

linkcheck:
	@$(SPHINXBUILD) -b linkcheck "$(SOURCEDIR)" "$(BUILDDIR)/linkcheck" $(SPHINXOPTS)
	@echo ""
	@echo "Link check complete. See $(BUILDDIR)/linkcheck/output.txt"
