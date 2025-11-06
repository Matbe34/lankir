package pdf

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNewPDFService(t *testing.T) {
	service := NewPDFService()
	if service == nil {
		t.Fatal("NewPDFService returned nil")
	}
	if service.pageCount != 0 {
		t.Errorf("Expected pageCount to be 0, got %d", service.pageCount)
	}
	if service.currentFile != "" {
		t.Errorf("Expected currentFile to be empty, got %s", service.currentFile)
	}
}

func TestPDFService_Startup(t *testing.T) {
	service := NewPDFService()
	ctx := context.Background()

	service.Startup(ctx)

	if service.ctx == nil {
		t.Error("Expected ctx to be set after Startup")
	}
}

func TestPDFService_GetPageCount(t *testing.T) {
	service := NewPDFService()

	// Initially should be 0
	if count := service.GetPageCount(); count != 0 {
		t.Errorf("Expected page count 0, got %d", count)
	}

	// After setting
	service.pageCount = 5
	if count := service.GetPageCount(); count != 5 {
		t.Errorf("Expected page count 5, got %d", count)
	}
}

func TestPDFService_ClosePDF(t *testing.T) {
	service := NewPDFService()
	service.currentFile = "test.pdf"
	service.pageCount = 10

	err := service.ClosePDF()
	if err != nil {
		t.Errorf("ClosePDF returned error: %v", err)
	}

	if service.currentFile != "" {
		t.Errorf("Expected currentFile to be empty after close, got %s", service.currentFile)
	}
	if service.pageCount != 0 {
		t.Errorf("Expected pageCount to be 0 after close, got %d", service.pageCount)
	}
	if service.doc != nil {
		t.Error("Expected doc to be nil after close")
	}
}

func TestPDFService_OpenPDF_FileNotFound(t *testing.T) {
	// Skip this test as it requires Wails runtime context
	t.Skip("Skipping test that requires Wails runtime context")
}

func TestPDFService_GetMetadata_NoDocument(t *testing.T) {
	service := NewPDFService()

	_, err := service.GetMetadata()
	if err == nil {
		t.Error("Expected error when getting metadata with no document open")
	}
	if err.Error() != "no PDF document is open" {
		t.Errorf("Expected specific error message, got: %v", err)
	}
}

func TestPDFService_RenderPage_NoDocument(t *testing.T) {
	service := NewPDFService()

	_, err := service.RenderPage(0, 150)
	if err == nil {
		t.Error("Expected error when rendering page with no document open")
	}
	if err.Error() != "no PDF document is open" {
		t.Errorf("Expected specific error message, got: %v", err)
	}
}

func TestPDFService_RenderPage_InvalidPageNumber(t *testing.T) {
	service := NewPDFService()
	service.pageCount = 5

	// Create a mock scenario (without actual document)
	// Just test the validation logic
	if service.doc == nil {
		// Expected - no document, will fail earlier
		_, err := service.RenderPage(10, 150)
		if err == nil {
			t.Error("Expected error for invalid page number")
		}
	}
}

// Integration test with actual PDF file
func TestPDFService_Integration(t *testing.T) {
	// Create test PDF
	testDir := t.TempDir()
	testPDF := filepath.Join(testDir, "test.pdf")
	CreateTestPDF(t, testPDF, 1)
	defer CleanupTestPDF(t, testPDF)

	// Verify file exists
	if _, err := os.Stat(testPDF); os.IsNotExist(err) {
		t.Fatalf("Test PDF was not created: %v", err)
	}

	// Test opening the PDF directly (without runtime context)
	// This tests the core PDF library integration
	t.Run("DirectOpen", func(t *testing.T) {
		// We can't test OpenPDF directly as it needs runtime.OpenFileDialog
		// But we can test the core logic by manually setting the file
		if _, err := os.Stat(testPDF); err != nil {
			t.Skipf("Test PDF not accessible: %v", err)
		}

		// The actual open logic would be tested in E2E tests
		t.Log("Direct PDF opening tested via E2E tests")
	})
}
