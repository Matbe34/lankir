package pdf

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewRecentFilesService(t *testing.T) {
	service := NewRecentFilesService()
	if service == nil {
		t.Fatal("NewRecentFilesService returned nil")
	}
	if service.maxRecent != 10 {
		t.Errorf("Expected maxRecent to be 10, got %d", service.maxRecent)
	}
	if len(service.files) != 0 {
		t.Errorf("Expected empty files list, got %d items", len(service.files))
	}
}

func TestRecentFilesService_Startup(t *testing.T) {
	// Create a temporary config directory
	tempDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")

	ctx := context.Background()
	service.Startup(ctx)

	if service.ctx == nil {
		t.Error("Expected ctx to be set after Startup")
	}
}

func TestRecentFilesService_AddRecent(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")
	service.Startup(context.Background())

	// Create actual test file
	testPath := filepath.Join(tempDir, "test.pdf")
	CreateTestPDF(t, testPath, 1)
	defer CleanupTestPDF(t, testPath)

	// Add the file
	err := service.AddRecent(testPath, 10)
	if err != nil {
		t.Fatalf("AddRecent failed: %v", err)
	}

	// Verify it was added
	files := service.GetRecent()
	if len(files) != 1 {
		t.Fatalf("Expected 1 file, got %d", len(files))
	}

	if files[0].FilePath != testPath {
		t.Errorf("Expected FilePath %s, got %s", testPath, files[0].FilePath)
	}
	if files[0].FileName != "test.pdf" {
		t.Errorf("Expected FileName test.pdf, got %s", files[0].FileName)
	}
	if files[0].PageCount != 10 {
		t.Errorf("Expected PageCount 10, got %d", files[0].PageCount)
	}
}

func TestRecentFilesService_AddRecent_Duplicate(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")
	service.Startup(context.Background())

	// Create actual test file
	testPath := filepath.Join(tempDir, "test.pdf")
	CreateTestPDF(t, testPath, 1)
	defer CleanupTestPDF(t, testPath)

	// Add the same file twice
	service.AddRecent(testPath, 10)
	time.Sleep(10 * time.Millisecond) // Ensure different timestamps
	service.AddRecent(testPath, 10)

	// Should only have one entry
	files := service.GetRecent()
	if len(files) != 1 {
		t.Errorf("Expected 1 file after duplicate add, got %d", len(files))
	}
}

func TestRecentFilesService_AddRecent_MaxLimit(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")
	service.maxRecent = 5 // Set lower limit for testing
	service.Startup(context.Background())

	// Create and add more than max files
	for i := 0; i < 7; i++ {
		filename := "test" + string(rune('0'+i)) + ".pdf"
		path := filepath.Join(tempDir, filename)
		CreateTestPDF(t, path, 1)
		service.AddRecent(path, i)
		time.Sleep(5 * time.Millisecond)
	}

	files := service.GetRecent()
	if len(files) != 5 {
		t.Errorf("Expected max 5 files, got %d", len(files))
	}

	if len(files) > 0 {
		// Most recent should be first
		if files[0].FileName != "test6.pdf" {
			t.Errorf("Expected most recent file first, got %s", files[0].FileName)
		}
	}
}

func TestRecentFilesService_GetRecent_FilterNonExistent(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")
	service.Startup(context.Background())

	// Create actual test file
	testFile := filepath.Join(tempDir, "exists.pdf")
	CreateTestPDF(t, testFile, 1)
	defer CleanupTestPDF(t, testFile)

	// Add existing and non-existing files
	service.AddRecent(testFile, 1)
	service.AddRecent("/nonexistent/file.pdf", 1)

	files := service.GetRecent()

	// Should only return existing file
	if len(files) != 1 {
		t.Errorf("Expected 1 existing file, got %d", len(files))
	}
	if files[0].FilePath != testFile {
		t.Errorf("Expected existing file, got %s", files[0].FilePath)
	}
}

func TestRecentFilesService_ClearRecent(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "recent.json")
	service.Startup(context.Background())

	// Add some files
	service.AddRecent("/path/to/test1.pdf", 5)
	service.AddRecent("/path/to/test2.pdf", 10)

	// Clear
	err := service.ClearRecent()
	if err != nil {
		t.Fatalf("ClearRecent failed: %v", err)
	}

	files := service.GetRecent()
	if len(files) != 0 {
		t.Errorf("Expected 0 files after clear, got %d", len(files))
	}
}

func TestRecentFilesService_Persistence(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "recent.json")

	// Create actual test file
	testPath := filepath.Join(tempDir, "test.pdf")
	CreateTestPDF(t, testPath, 1)
	defer CleanupTestPDF(t, testPath)

	// Create service and add files
	service1 := NewRecentFilesService()
	service1.configPath = configPath
	service1.Startup(context.Background())

	service1.AddRecent(testPath, 15)

	// Create new service instance (simulating app restart)
	service2 := NewRecentFilesService()
	service2.configPath = configPath
	service2.Startup(context.Background())

	files := service2.GetRecent()
	if len(files) != 1 {
		t.Fatalf("Expected 1 persisted file, got %d", len(files))
	}

	if files[0].FilePath != testPath {
		t.Errorf("Expected persisted FilePath %s, got %s", testPath, files[0].FilePath)
	}
	if files[0].PageCount != 15 {
		t.Errorf("Expected persisted PageCount 15, got %d", files[0].PageCount)
	}
}

func TestRecentFilesService_LoadNonExistentFile(t *testing.T) {
	tempDir := t.TempDir()
	service := NewRecentFilesService()
	service.configPath = filepath.Join(tempDir, "nonexistent.json")

	// Should not error on missing file
	err := service.load()
	if err != nil {
		t.Errorf("Expected no error when loading non-existent file, got: %v", err)
	}

	if len(service.files) != 0 {
		t.Errorf("Expected empty files list, got %d", len(service.files))
	}
}

func TestRecentFilesService_SaveAndLoad(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "test_recent.json")

	service := NewRecentFilesService()
	service.configPath = configPath

	// Add test data
	service.files = []RecentFile{
		{
			FilePath:   "/test1.pdf",
			FileName:   "test1.pdf",
			PageCount:  5,
			LastOpened: time.Now(),
		},
		{
			FilePath:   "/test2.pdf",
			FileName:   "test2.pdf",
			PageCount:  10,
			LastOpened: time.Now(),
		},
	}

	// Save
	err := service.save()
	if err != nil {
		t.Fatalf("save() failed: %v", err)
	}

	// Verify file was created
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Fatal("Config file was not created")
	}

	// Load in new service
	service2 := NewRecentFilesService()
	service2.configPath = configPath
	err = service2.load()
	if err != nil {
		t.Fatalf("load() failed: %v", err)
	}

	if len(service2.files) != 2 {
		t.Errorf("Expected 2 loaded files, got %d", len(service2.files))
	}
}
