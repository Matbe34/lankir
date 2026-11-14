package pdf

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/gen2brain/go-fitz"
)

// Renderer rasterises PDF pages with MuPDF (go-fitz) for the CLI's info,
// pages, render and thumbnail commands. The GUI renders with pdf.js instead.
type Renderer struct {
	currentFile               string
	pageCount                 int
	doc                       *fitz.Document
	annotationRenderingFailed bool
	mu                        sync.RWMutex
}

// PageInfo contains information about a rendered PDF page including dimensions and image data.
type PageInfo struct {
	PageNumber int    `json:"pageNumber"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	ImageData  string `json:"imageData"` // Base64 encoded PNG
}

// PDFMetadata contains metadata extracted from a PDF document.
type PDFMetadata struct {
	Title     string `json:"title"`
	Author    string `json:"author"`
	Subject   string `json:"subject"`
	Creator   string `json:"creator"`
	PageCount int    `json:"pageCount"`
	FilePath  string `json:"filePath"`
}

// NewRenderer creates a MuPDF renderer with no document open.
func NewRenderer() *Renderer {
	return &Renderer{}
}

// OpenPDFByPath opens a PDF file from the given path and returns its metadata.
func (s *Renderer) OpenPDFByPath(filePath string) (*PDFMetadata, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.Size() > MaxPDFFileSizeBytes {
		return nil, fmt.Errorf("PDF file too large: %d bytes (max %d bytes)", fileInfo.Size(), MaxPDFFileSizeBytes)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.doc != nil {
		s.doc.Close()
	}

	// Open PDF with timeout to prevent hanging on malformed files
	type openResult struct {
		doc *fitz.Document
		err error
	}

	ctx, cancel := context.WithTimeout(context.Background(), PDFOpenTimeout)
	defer cancel()

	resultChan := make(chan openResult, 1)
	go func() {
		doc, err := fitz.New(filePath)
		defer func() {
			select {
			case <-ctx.Done():
				if doc != nil && err == nil {
					doc.Close()
				}
			default:
			}
		}()

		select {
		case resultChan <- openResult{doc: doc, err: err}:
		case <-ctx.Done():
		}
	}()

	select {
	case result := <-resultChan:
		if result.err != nil {
			return nil, fmt.Errorf("failed to open PDF: %w", result.err)
		}

		s.doc = result.doc
		s.currentFile = filePath
		s.pageCount = result.doc.NumPage()
		s.annotationRenderingFailed = false

		info := result.doc.Metadata()
		return &PDFMetadata{
			Title:     metadataString(info["title"]),
			Author:    metadataString(info["author"]),
			Subject:   metadataString(info["subject"]),
			Creator:   metadataString(info["creator"]),
			PageCount: s.pageCount,
			FilePath:  filePath,
		}, nil

	case <-ctx.Done():
		return nil, fmt.Errorf("timeout opening PDF file (exceeded %v)", PDFOpenTimeout)
	}
}

// metadataString turns a go-fitz metadata value, a C string in a NUL-padded
// fixed buffer, into the string it holds, without trailing whitespace.
func metadataString(s string) string {
	s, _, _ = strings.Cut(s, "\x00")
	return strings.TrimRightFunc(s, unicode.IsSpace)
}

// ClosePDF closes the currently open PDF document and releases resources.
func (s *Renderer) ClosePDF() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.doc != nil {
		s.doc.Close()
		s.doc = nil
	}
	s.currentFile = ""
	s.pageCount = 0
	return nil
}

const (
	MinDPI              = 10.0
	MaxDPI              = 600.0
	PDFOpenTimeout      = 120 * time.Second
	PDFRenderTimeout    = 300 * time.Second
	MaxPDFFileSizeBytes = 1 * 1024 * 1024 * 1024 // 1GB maximum file size
)

// RenderPage renders the specified page at the given DPI and returns base64-encoded PNG data.
func (s *Renderer) RenderPage(pageNum int, dpi float64) (*PageInfo, error) {
	if dpi < MinDPI || dpi > MaxDPI {
		return nil, fmt.Errorf("DPI %.2f out of valid range [%.2f, %.2f]", dpi, MinDPI, MaxDPI)
	}

	s.mu.RLock()
	doc := s.doc
	pageCount := s.pageCount
	annotFailed := s.annotationRenderingFailed
	s.mu.RUnlock()

	if doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= pageCount {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, pageCount)
	}

	if !annotFailed {
		result, err := s.renderPageWithAnnotations(pageNum, dpi)
		if err == nil {
			return result, nil
		}
		s.mu.Lock()
		s.annotationRenderingFailed = true
		s.mu.Unlock()
	}

	return s.renderPageStandard(pageNum, dpi)
}

// DecodePNGDataURL returns the raw PNG bytes of the data URLs RenderPage and
// GenerateThumbnail produce.
func DecodePNGDataURL(s string) ([]byte, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(s, prefix) {
		return nil, fmt.Errorf("not a PNG data URL")
	}
	return base64.StdEncoding.DecodeString(s[len(prefix):])
}

// GetPageCount returns the total number of pages in the open PDF.
func (s *Renderer) GetPageCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pageCount
}

// PageDimensions represents the dimensions of a PDF page
type PageDimensions struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// GetPageDimensions returns the width and height of a page in PDF points.
// Holds an exclusive lock because MuPDF's fz_context is not safe for concurrent
// access — see also GetMetadata.
func (s *Renderer) GetPageDimensions(pageNum int) (*PageDimensions, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= s.pageCount {
		return nil, fmt.Errorf("invalid page number: %d", pageNum)
	}

	bounds, err := s.doc.Bound(pageNum)
	if err != nil {
		return nil, fmt.Errorf("failed to get page bounds: %w", err)
	}

	return &PageDimensions{
		Width:  float64(bounds.Dx()),
		Height: float64(bounds.Dy()),
	}, nil
}

// GenerateThumbnail generates a 16:9 cropped thumbnail of the first page as base64 PNG.
func (s *Renderer) GenerateThumbnail(filePath string, maxWidth int) (string, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("file does not exist: %s", filePath)
		}
		return "", fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.Size() > MaxPDFFileSizeBytes {
		return "", fmt.Errorf("PDF file too large: %d bytes (max %d bytes)", fileInfo.Size(), MaxPDFFileSizeBytes)
	}

	type thumbnailResult struct {
		data string
		err  error
	}

	ctx, cancel := context.WithTimeout(context.Background(), PDFRenderTimeout)
	defer cancel()

	resultChan := make(chan thumbnailResult, 1)
	go func() {
		doc, err := fitz.New(filePath)
		if err != nil {
			select {
			case resultChan <- thumbnailResult{err: fmt.Errorf("failed to open PDF: %w", err)}:
			case <-ctx.Done():
			}
			return
		}
		defer doc.Close()

		if doc.NumPage() == 0 {
			select {
			case resultChan <- thumbnailResult{err: fmt.Errorf("PDF has no pages")}:
			case <-ctx.Done():
			}
			return
		}

		bounds, err := doc.Bound(0)
		if err != nil {
			select {
			case resultChan <- thumbnailResult{err: fmt.Errorf("failed to get page bounds: %w", err)}:
			case <-ctx.Done():
			}
			return
		}

		pageWidth := float64(bounds.Dx())
		dpi := (float64(maxWidth) / pageWidth) * 72.0

		img, err := doc.ImageDPI(0, dpi)
		if err != nil {
			select {
			case resultChan <- thumbnailResult{err: fmt.Errorf("failed to render page: %w", err)}:
			case <-ctx.Done():
			}
			return
		}

		imgBounds := img.Bounds()
		targetWidth := imgBounds.Dx()
		targetHeight := targetWidth * 9 / 16

		if targetHeight > imgBounds.Dy() {
			targetHeight = imgBounds.Dy()
		}

		croppedImg := img.SubImage(image.Rect(0, 0, targetWidth, targetHeight))

		var buf bytes.Buffer
		if err := png.Encode(&buf, croppedImg); err != nil {
			select {
			case resultChan <- thumbnailResult{err: fmt.Errorf("failed to encode PNG: %w", err)}:
			case <-ctx.Done():
			}
			return
		}

		base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())
		select {
		case resultChan <- thumbnailResult{data: "data:image/png;base64," + base64Data}:
		case <-ctx.Done():
		}
	}()

	select {
	case result := <-resultChan:
		if result.err != nil {
			return "", result.err
		}
		return result.data, nil

	case <-ctx.Done():
		return "", fmt.Errorf("timeout rendering PDF thumbnail (exceeded %v)", PDFRenderTimeout)
	}
}
