package pdf

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/png"
)

// RenderPageWithAnnotations renders a PDF page including all annotations and signature widgets
// This uses go-fitz which properly renders annotations
func (s *PDFService) renderPageWithAnnotations(pageNum int, dpi float64) (*PageInfo, error) {
	s.mu.RLock()
	doc := s.doc
	totalPages := s.pageCount
	s.mu.RUnlock()

	if doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= totalPages {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, totalPages)
	}

	// Render the page with annotations using go-fitz
	// ImageDPI renders the page at the specified DPI
	img, err := doc.ImageDPI(pageNum, dpi)
	if err != nil {
		return nil, fmt.Errorf("failed to render page: %w", err)
	}

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("failed to encode PNG: %w", err)
	}

	// Convert to base64
	base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())

	bounds := img.Bounds()
	return &PageInfo{
		PageNumber: pageNum,
		Width:      bounds.Dx(),
		Height:     bounds.Dy(),
		ImageData:  "data:image/png;base64," + base64Data,
	}, nil
}
