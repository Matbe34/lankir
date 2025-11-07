package pdf

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
)

// RenderPageWithAnnotations renders a PDF page including all annotations and signature widgets
// This uses pdftocairo which properly renders annotations, unlike go-fitz's ImageDPI
func (s *PDFService) renderPageWithAnnotations(pageNum int, dpi float64) (*PageInfo, error) {
	s.mu.RLock()
	filePath := s.currentFile
	totalPages := s.pageCount
	s.mu.RUnlock()

	if filePath == "" {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= totalPages {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, totalPages)
	}

	// Create temporary directory for rendered output
	tmpDir, err := os.MkdirTemp("", "pdf_render_*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	outputPath := filepath.Join(tmpDir, "page")

	// pdftocairo pages are 1-indexed, our pageNum is 0-indexed
	pageNumStr := fmt.Sprintf("%d", pageNum+1)

	// Use pdftocairo to render the page with annotations
	// -png: output as PNG
	// -f: first page to render
	// -l: last page to render
	// -r: resolution in DPI
	// -singlefile: output a single file (not page-NN.png)
	cmd := exec.Command("pdftocairo",
		"-png",
		"-f", pageNumStr,
		"-l", pageNumStr,
		"-r", fmt.Sprintf("%.0f", dpi),
		"-singlefile",
		filePath,
		outputPath,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("pdftocairo failed: %w, stderr: %s", err, stderr.String())
	}

	// Read the generated PNG file
	pngPath := outputPath + ".png"
	pngData, err := os.ReadFile(pngPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read rendered PNG: %w", err)
	}

	// Decode PNG to get dimensions
	img, err := png.Decode(bytes.NewReader(pngData))
	if err != nil {
		return nil, fmt.Errorf("failed to decode PNG: %w", err)
	}

	// Convert to base64
	base64Data := base64.StdEncoding.EncodeToString(pngData)

	bounds := img.Bounds()
	return &PageInfo{
		PageNumber: pageNum,
		Width:      bounds.Dx(),
		Height:     bounds.Dy(),
		ImageData:  "data:image/png;base64," + base64Data,
	}, nil
}
