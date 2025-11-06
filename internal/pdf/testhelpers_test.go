package pdf

import (
	"os"
	"path/filepath"
	"testing"
)

// CreateTestPDF creates a simple test PDF file
func CreateTestPDF(t *testing.T, path string, pages int) {
	t.Helper()

	// Create directory if needed
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("Failed to create test directory: %v", err)
	}

	// For testing, we'll create a simple text file that simulates PDF structure
	// In a real scenario, you'd use a PDF generation library
	// For now, we'll copy a minimal PDF or create one
	content := []byte(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 24 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF
`)

	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatalf("Failed to create test PDF: %v", err)
	}
}

// CleanupTestPDF removes a test PDF file
func CleanupTestPDF(t *testing.T, path string) {
	t.Helper()
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		t.Logf("Failed to cleanup test PDF: %v", err)
	}
}
