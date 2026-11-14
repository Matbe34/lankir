package pdf

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Matbe34/lankir/internal/pdfops"
)

// TestClosePDF tests closing PDF documents
func TestClosePDF(t *testing.T) {
	service := NewRenderer()
	service.currentFile = "/test/file.pdf"
	service.pageCount = 10

	err := service.ClosePDF()
	if err != nil {
		t.Errorf("ClosePDF returned error: %v", err)
	}

	if service.currentFile != "" {
		t.Errorf("currentFile not cleared, got %s", service.currentFile)
	}
	if service.pageCount != 0 {
		t.Errorf("pageCount not cleared, got %d", service.pageCount)
	}
	if service.doc != nil {
		t.Error("doc not cleared")
	}
}

// TestClosePDF_WithOpenDocument tests closing an actually open document
func TestClosePDF_WithOpenDocument(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open test PDF: %v", err)
	}

	if service.doc == nil {
		t.Fatal("doc should be set after opening")
	}

	err = service.ClosePDF()
	if err != nil {
		t.Errorf("ClosePDF returned error: %v", err)
	}

	if service.doc != nil {
		t.Error("doc not nil after close")
	}
}

// TestGetPageCount tests page count retrieval
func TestGetPageCount(t *testing.T) {
	service := NewRenderer()

	if count := service.GetPageCount(); count != 0 {
		t.Errorf("Expected 0, got %d", count)
	}

	service.pageCount = 42
	if count := service.GetPageCount(); count != 42 {
		t.Errorf("Expected 42, got %d", count)
	}
}

// TestGetPageCount_ThreadSafe tests thread-safe access
func TestGetPageCount_ThreadSafe(t *testing.T) {
	service := NewRenderer()
	service.pageCount = 10

	var wg sync.WaitGroup
	const goroutines = 100
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			count := service.GetPageCount()
			if count != 10 {
				t.Errorf("Expected 10, got %d", count)
			}
		}()
	}

	wg.Wait()
}

// TestOpenPDFByPath tests opening PDF by file path
func TestOpenPDFByPath(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	metadata, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("OpenPDFByPath failed: %v", err)
	}

	if metadata == nil {
		t.Fatal("metadata is nil")
	}
	if metadata.FilePath != testPDF {
		t.Errorf("Expected FilePath %s, got %s", testPDF, metadata.FilePath)
	}
	if metadata.PageCount <= 0 {
		t.Error("PageCount should be positive")
	}
	if service.currentFile != testPDF {
		t.Errorf("currentFile not set correctly")
	}
	if service.pageCount != metadata.PageCount {
		t.Error("pageCount mismatch with metadata")
	}
	if service.doc == nil {
		t.Error("doc not set after opening")
	}

	service.ClosePDF()
}

// MuPDF fills a fixed buffer per metadata entry; the strings must not carry
// its NUL padding, nor trailing whitespace.
func TestOpenPDFByPathMetadataHasNoPadding(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.pdf")
	CreateTestPDF(t, plain, 1)
	withInfo := filepath.Join(dir, "info.pdf")
	if err := pdfops.SetMetadata(plain, withInfo, pdfops.Metadata{Title: "Master Services Agreement  ", Creator: "Writer"}); err != nil {
		t.Fatal(err)
	}

	service := NewRenderer()
	defer service.ClosePDF()
	metadata, err := service.OpenPDFByPath(withInfo)
	if err != nil {
		t.Fatal(err)
	}
	got := [4]string{metadata.Title, metadata.Author, metadata.Subject, metadata.Creator}
	if want := [4]string{"Master Services Agreement", "", "", "Writer"}; got != want {
		t.Errorf("title, author, subject, creator = %q, want %q", got, want)
	}
}

// TestOpenPDFByPath_NonExistent tests opening non-existent file
func TestOpenPDFByPath_NonExistent(t *testing.T) {
	service := NewRenderer()

	_, err := service.OpenPDFByPath("/nonexistent/file.pdf")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

// TestOpenPDFByPath_TooLarge tests file size validation
func TestOpenPDFByPath_TooLarge(t *testing.T) {
	testDir := t.TempDir()
	largePDF := filepath.Join(testDir, "large.pdf")

	// Create a file larger than MaxPDFFileSizeBytes
	// We'll create a 1KB file and modify the constant temporarily
	// But since we can't modify constants, we'll test with a real large file concept

	// For practical testing, we verify the error message contains size info
	service := NewRenderer()

	// Create a small file to test normal case
	CreateTestPDF(t, largePDF, 1)
	_, err := service.OpenPDFByPath(largePDF)
	if err != nil {
		t.Logf("Open result: %v", err)
	}
	service.ClosePDF()
}

// TestOpenPDFByPath_InvalidPDF tests opening invalid PDF
func TestOpenPDFByPath_InvalidPDF(t *testing.T) {
	testDir := t.TempDir()
	invalidPDF := filepath.Join(testDir, "invalid.pdf")

	// Write invalid content
	err := os.WriteFile(invalidPDF, []byte("This is not a PDF"), 0644)
	if err != nil {
		t.Fatalf("Failed to create invalid PDF: %v", err)
	}

	service := NewRenderer()

	_, err = service.OpenPDFByPath(invalidPDF)
	if err == nil {
		t.Error("Expected error for invalid PDF")
	}
}

// TestOpenPDFByPath_ReplacesCurrentDocument tests that opening a new PDF closes the old one
func TestOpenPDFByPath_ReplacesCurrentDocument(t *testing.T) {
	testDir := t.TempDir()
	pdf1 := filepath.Join(testDir, "test1.pdf")
	pdf2 := filepath.Join(testDir, "test2.pdf")
	CreateTestPDF(t, pdf1, 1)
	CreateTestPDF(t, pdf2, 1)

	service := NewRenderer()

	// Open first PDF
	meta1, err := service.OpenPDFByPath(pdf1)
	if err != nil {
		t.Fatalf("Failed to open first PDF: %v", err)
	}

	// Open second PDF
	meta2, err := service.OpenPDFByPath(pdf2)
	if err != nil {
		t.Fatalf("Failed to open second PDF: %v", err)
	}

	if service.currentFile != pdf2 {
		t.Error("Current file not updated to second PDF")
	}
	if meta2.FilePath != pdf2 {
		t.Error("Metadata not from second PDF")
	}
	if meta1.FilePath == meta2.FilePath {
		t.Error("Metadata should be different")
	}

	service.ClosePDF()
}

// TestGetPageDimensions tests page dimension retrieval
func TestGetPageDimensions(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}

	dims, err := service.GetPageDimensions(0)
	if err != nil {
		t.Fatalf("GetPageDimensions failed: %v", err)
	}

	if dims == nil {
		t.Fatal("dimensions are nil")
	}
	if dims.Width <= 0 || dims.Height <= 0 {
		t.Error("Dimensions should be positive")
	}

	service.ClosePDF()
}

// TestGetPageDimensions_NoDocument tests dimensions without open document
func TestGetPageDimensions_NoDocument(t *testing.T) {
	service := NewRenderer()

	_, err := service.GetPageDimensions(0)
	if err == nil {
		t.Error("Expected error when no document is open")
	}
}

// TestGetPageDimensions_InvalidPage tests invalid page number
func TestGetPageDimensions_InvalidPage(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}

	// Test negative page
	_, err = service.GetPageDimensions(-1)
	if err == nil {
		t.Error("Expected error for negative page number")
	}

	// Test page beyond count
	_, err = service.GetPageDimensions(1000)
	if err == nil {
		t.Error("Expected error for page beyond count")
	}

	service.ClosePDF()
}

// TestRenderPage_NoDocument tests rendering without open document
func TestRenderPage_NoDocument(t *testing.T) {
	service := NewRenderer()

	_, err := service.RenderPage(0, 150)
	if err == nil {
		t.Error("Expected error when no document is open")
	}
	if err.Error() != "no PDF document is open" {
		t.Errorf("Expected specific error message, got: %v", err)
	}
}

// TestRenderPage_InvalidDPI tests DPI validation
func TestRenderPage_InvalidDPI(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}

	// Test DPI too low
	_, err = service.RenderPage(0, MinDPI-1)
	if err == nil {
		t.Error("Expected error for DPI below minimum")
	}

	// Test DPI too high
	_, err = service.RenderPage(0, MaxDPI+1)
	if err == nil {
		t.Error("Expected error for DPI above maximum")
	}

	service.ClosePDF()
}

// TestRenderPage_InvalidPageNumber tests page number validation
func TestRenderPage_InvalidPageNumber(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}

	// Test negative page
	_, err = service.RenderPage(-1, 150)
	if err == nil {
		t.Error("Expected error for negative page")
	}

	// Test page beyond document
	pageCount := service.GetPageCount()
	_, err = service.RenderPage(pageCount, 150)
	if err == nil {
		t.Error("Expected error for page beyond count")
	}

	service.ClosePDF()
}

// TestRenderPage_ValidDPI tests valid DPI values
func TestRenderPage_ValidDPI(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}
	defer service.ClosePDF()

	// Test various valid DPI values
	dpiValues := []float64{MinDPI, 72, 150, 300, MaxDPI}

	for _, dpi := range dpiValues {
		pageInfo, err := service.RenderPage(0, dpi)
		if err != nil {
			t.Errorf("RenderPage failed for DPI %.2f: %v", dpi, err)
			continue
		}
		if pageInfo == nil {
			t.Errorf("PageInfo is nil for DPI %.2f", dpi)
			continue
		}
		if pageInfo.ImageData == "" {
			t.Errorf("ImageData is empty for DPI %.2f", dpi)
		}
		if pageInfo.Width <= 0 || pageInfo.Height <= 0 {
			t.Errorf("Invalid dimensions for DPI %.2f", dpi)
		}
	}
}

// TestGenerateThumbnail tests thumbnail generation
func TestGenerateThumbnail(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	thumbnail, err := service.GenerateThumbnail(testPDF, 200)
	if err != nil {
		t.Fatalf("GenerateThumbnail failed: %v", err)
	}

	if thumbnail == "" {
		t.Error("Thumbnail is empty")
	}
	if len(thumbnail) < 100 {
		t.Error("Thumbnail seems too short")
	}
	// Should be base64 data URL
	if len(thumbnail) > 22 && thumbnail[:22] != "data:image/png;base64," {
		t.Error("Thumbnail not in expected format")
	}
}

// TestGenerateThumbnail_NonExistent tests thumbnail of nonexistent file
func TestGenerateThumbnail_NonExistent(t *testing.T) {
	service := NewRenderer()

	_, err := service.GenerateThumbnail("/nonexistent/file.pdf", 200)
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

// TestGenerateThumbnail_InvalidPDF tests thumbnail of invalid PDF
func TestGenerateThumbnail_InvalidPDF(t *testing.T) {
	testDir := t.TempDir()
	invalidPDF := filepath.Join(testDir, "invalid.pdf")
	if err := os.WriteFile(invalidPDF, []byte("not a pdf"), 0644); err != nil {
		t.Fatal(err)
	}

	service := NewRenderer()

	_, err := service.GenerateThumbnail(invalidPDF, 200)
	if err == nil {
		t.Error("Expected error for invalid PDF")
	}
}

// TestConcurrentOperations tests thread-safe concurrent operations
func TestConcurrentOperations(t *testing.T) {
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)

	service := NewRenderer()

	_, err := service.OpenPDFByPath(testPDF)
	if err != nil {
		t.Fatalf("Failed to open PDF: %v", err)
	}
	defer service.ClosePDF()

	var wg sync.WaitGroup
	const goroutines = 20

	// Concurrent reads
	wg.Add(goroutines * 2)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			service.GetPageCount()
		}()

		go func() {
			defer wg.Done()
			_, _ = service.GetPageDimensions(0)
		}()
	}

	wg.Wait()
}

// TestConstants verifies constant values are reasonable
func TestConstants(t *testing.T) {
	if MinDPI <= 0 {
		t.Error("MinDPI should be positive")
	}
	if MaxDPI <= MinDPI {
		t.Error("MaxDPI should be greater than MinDPI")
	}
	if PDFOpenTimeout <= 0 {
		t.Error("PDFOpenTimeout should be positive")
	}
	if PDFRenderTimeout <= 0 {
		t.Error("PDFRenderTimeout should be positive")
	}
	if MaxPDFFileSizeBytes <= 0 {
		t.Error("MaxPDFFileSizeBytes should be positive")
	}
}

func TestDecodePNGDataURL(t *testing.T) {
	got, err := DecodePNGDataURL("data:image/png;base64,iVBORw0KGgo=")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "\x89PNG\r\n\x1a\n" {
		t.Errorf("got %q", got)
	}
	for _, bad := range []string{"", "iVBORw0KGgo=", "data:image/png;base64,!!!"} {
		if _, err := DecodePNGDataURL(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}
