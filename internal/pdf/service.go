package pdf

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/gen2brain/go-fitz"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// PDFService handles all PDF operations
type PDFService struct {
	ctx         context.Context
	currentFile string
	pageCount   int
	doc         *fitz.Document
	mu          sync.RWMutex // Protects doc access
}

// PageInfo contains information about a PDF page
type PageInfo struct {
	PageNumber int    `json:"pageNumber"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	ImageData  string `json:"imageData"` // Base64 encoded PNG
}

// PDFMetadata contains PDF document metadata
type PDFMetadata struct {
	Title     string `json:"title"`
	Author    string `json:"author"`
	Subject   string `json:"subject"`
	Creator   string `json:"creator"`
	PageCount int    `json:"pageCount"`
	FilePath  string `json:"filePath"`
}

// NewPDFService creates a new PDF service
func NewPDFService() *PDFService {
	return &PDFService{}
}

// Startup is called when the app starts
func (s *PDFService) Startup(ctx context.Context) {
	s.ctx = ctx
}

// OpenPDF opens a PDF file dialog and loads the selected file
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
		// User cancelled, return nil without error
		return nil, nil
	}

	// Verify file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("file does not exist: %s", filePath)
	}

	// Lock for document replacement
	s.mu.Lock()
	defer s.mu.Unlock()

	// Close existing document if any
	if s.doc != nil {
		s.doc.Close()
	}

	// Open the PDF document
	doc, err := fitz.New(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open PDF: %w", err)
	}

	s.doc = doc
	s.currentFile = filePath
	s.pageCount = doc.NumPage()

	// Get metadata
	metadata := &PDFMetadata{
		Title:     doc.Metadata()["title"],
		Author:    doc.Metadata()["author"],
		Subject:   doc.Metadata()["subject"],
		Creator:   doc.Metadata()["creator"],
		PageCount: s.pageCount,
		FilePath:  filePath,
	}

	return metadata, nil
}

// OpenPDFByPath opens a PDF file by its file path (for recent files)
func (s *PDFService) OpenPDFByPath(filePath string) (*PDFMetadata, error) {
	// Verify file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("file does not exist: %s", filePath)
	}

	// Lock for document replacement
	s.mu.Lock()
	defer s.mu.Unlock()

	// Close existing document if any
	if s.doc != nil {
		s.doc.Close()
	}

	// Open the PDF document
	doc, err := fitz.New(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open PDF: %w", err)
	}

	s.doc = doc
	s.currentFile = filePath
	s.pageCount = doc.NumPage()

	// Get metadata
	metadata := &PDFMetadata{
		Title:     doc.Metadata()["title"],
		Author:    doc.Metadata()["author"],
		Subject:   doc.Metadata()["subject"],
		Creator:   doc.Metadata()["creator"],
		PageCount: s.pageCount,
		FilePath:  filePath,
	}

	return metadata, nil
}

// ClosePDF closes the current PDF file
func (s *PDFService) ClosePDF() error {
	if s.doc != nil {
		s.doc.Close()
		s.doc = nil
	}
	s.currentFile = ""
	s.pageCount = 0
	return nil
}

// RenderPage renders a specific page and returns it as base64-encoded PNG
func (s *PDFService) RenderPage(pageNum int, dpi float64) (*PageInfo, error) {
	// Use the new rendering method that includes annotations
	return s.renderPageWithAnnotations(pageNum, dpi)
}

// GetPageCount returns the number of pages in the current PDF
func (s *PDFService) GetPageCount() int {
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
