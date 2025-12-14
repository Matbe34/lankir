package pdf

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"os"
	"sync"
	"time"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/gen2brain/go-fitz"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// PDFService handles all PDF operations including opening, rendering, and metadata extraction.
// It uses go-fitz for PDF rendering and maintains thread-safe access to the current document.
type PDFService struct {
	ctx                       context.Context
	currentFile               string
	pageCount                 int
	doc                       *fitz.Document
	annotationRenderingFailed bool
	configService             *config.Service
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

// NewPDFService creates a new PDF service instance.
func NewPDFService(configService *config.Service) *PDFService {
	return &PDFService{
		configService: configService,
	}
}

// Startup initializes the service with the application context.
// This is called by the Wails runtime during application startup.
func (s *PDFService) Startup(ctx context.Context) {
	s.ctx = ctx

	if s.configService != nil {
		cfg := s.configService.Get()
		if cfg != nil && !cfg.DebugMode {
			SuppressMuPDFWarnings()
		}
	}
}

// OpenPDF displays a file selection dialog and opens the selected PDF file.
// Returns metadata about the opened PDF or an error if the operation fails.
func (s *PDFService) OpenPDF() (*PDFMetadata, error) {
	filePath, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "Select PDF File",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})

	if err != nil {
		return nil, err
	}

	if filePath == "" {
		return nil, nil
	}

	return s.OpenPDFByPath(filePath)
}

// OpenPDFByPath opens a PDF file by its file path (for recent files)
func (s *PDFService) OpenPDFByPath(filePath string) (*PDFMetadata, error) {
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

		return &PDFMetadata{
			Title:     result.doc.Metadata()["title"],
			Author:    result.doc.Metadata()["author"],
			Subject:   result.doc.Metadata()["subject"],
			Creator:   result.doc.Metadata()["creator"],
			PageCount: s.pageCount,
			FilePath:  filePath,
		}, nil

	case <-ctx.Done():
		return nil, fmt.Errorf("timeout opening PDF file (exceeded %v)", PDFOpenTimeout)
	}
}

// ClosePDF closes the current PDF file
func (s *PDFService) ClosePDF() error {
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

// RenderPage renders a specific page and returns it as base64-encoded PNG
func (s *PDFService) RenderPage(pageNum int, dpi float64) (*PageInfo, error) {
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

// GetPageCount returns the number of pages in the current PDF
func (s *PDFService) GetPageCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pageCount
}

// PageDimensions represents the dimensions of a PDF page
type PageDimensions struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// GetPageDimensions returns the dimensions of a specific page in points
func (s *PDFService) GetPageDimensions(pageNum int) (*PageDimensions, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

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

// GetMetadata returns metadata for the current PDF
func (s *PDFService) GetMetadata() (*PDFMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	return &PDFMetadata{
		Title:     s.doc.Metadata()["title"],
		Author:    s.doc.Metadata()["author"],
		Subject:   s.doc.Metadata()["subject"],
		Creator:   s.doc.Metadata()["creator"],
		PageCount: s.pageCount,
		FilePath:  s.currentFile,
	}, nil
}

// GenerateThumbnail generates a thumbnail for the first page of a PDF file
// This is used for recent files preview without opening the full document
// The thumbnail is cropped to 16:9 aspect ratio showing the top portion
func (s *PDFService) GenerateThumbnail(filePath string, maxWidth int) (string, error) {
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
