package pdf

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image/png"
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
	// Use read lock to allow concurrent rendering but prevent document replacement
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= s.pageCount {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, s.pageCount)
	}

	// Render the page as an image
	img, err := s.doc.Image(pageNum)
	if err != nil {
		return nil, fmt.Errorf("failed to render page: %w", err)
	}

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("failed to encode image: %w", err)
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

// GetPageCount returns the number of pages in the current PDF
func (s *PDFService) GetPageCount() int {
	return s.pageCount
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
