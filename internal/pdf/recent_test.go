package pdf

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestNewRecentFilesService tests service creation
func TestNewRecentFilesService(t *testing.T) {
	service := NewRecentFilesService()

	if service == nil {
		t.Fatal("NewRecentFilesService returned nil")
	}
	if service.maxRecent != DefaultMaxRecentFiles {
		t.Errorf("Expected maxRecent %d, got %d", DefaultMaxRecentFiles, service.maxRecent)
	}
	if len(service.files) != 0 {
		t.Error("Expected empty files list")
	}
	if service.configPath == "" {
		t.Error("configPath not set")
	}
}

// TestRecentFilesStartup tests service startup
func TestRecentFilesStartup(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")

	ctx := context.Background()
	service.Startup(ctx)

	if service.ctx == nil {
		t.Error("Context not set after Startup")
	}
	if service.ctx != ctx {
		t.Error("Context not correct")
	}
}

// TestRecentFilesStartup_LoadsExistingFiles tests that existing files are loaded on startup
func TestRecentFilesStartup_LoadsExistingFiles(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	// Create existing recent files
	existingFiles := []RecentFile{
		{
			FilePath:   testFile,
			FileName:   "test.pdf",
			LastOpened: time.Now(),
			PageCount:  5,
		},
	}

	data, _ := json.Marshal(existingFiles)
	os.WriteFile(configPath, data, 0600)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.Startup(context.Background())

	files := service.GetRecent()
	if len(files) != 1 {
		t.Errorf("Expected 1 file after loading, got %d", len(files))
	}
	if len(files) > 0 && files[0].FileName != "test.pdf" {
		t.Error("Loaded file has wrong name")
	}
}

// TestAddRecent tests adding a recent file
func TestAddRecent(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	err := service.AddRecent(testFile, 10)
	if err != nil {
		t.Fatalf("AddRecent failed: %v", err)
	}

	files := service.GetRecent()
	if len(files) != 1 {
		t.Fatalf("Expected 1 file, got %d", len(files))
	}

	file := files[0]
	if file.FilePath != testFile {
		t.Errorf("Expected FilePath %s, got %s", testFile, file.FilePath)
	}
	if file.FileName != "test.pdf" {
		t.Errorf("Expected FileName test.pdf, got %s", file.FileName)
	}
	if file.PageCount != 10 {
		t.Errorf("Expected PageCount 10, got %d", file.PageCount)
	}
	if file.LastOpened.IsZero() {
		t.Error("LastOpened not set")
	}
}

// TestAddRecent_Duplicate tests adding the same file twice
func TestAddRecent_Duplicate(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	// Add first time
	service.AddRecent(testFile, 10)
	time1 := service.files[0].LastOpened

	time.Sleep(10 * time.Millisecond)

	// Add second time
	service.AddRecent(testFile, 10)

	files := service.GetRecent()
	if len(files) != 1 {
		t.Errorf("Expected 1 file after duplicate add, got %d", len(files))
	}

	// Should have updated timestamp
	if !files[0].LastOpened.After(time1) {
		t.Error("Duplicate add should update LastOpened")
	}
}

// TestAddRecent_MaxLimit tests that only maxRecent files are kept
func TestAddRecent_MaxLimit(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.maxRecent = 5 // Set lower limit for testing
	service.Startup(context.Background())

	// Add more than max files
	for i := 0; i < 10; i++ {
		filename := filepath.Join(tmpDir, "test_"+string(rune('0'+i))+".pdf")
		CreateTestPDF(t, filename, 1)
		service.AddRecent(filename, i)
		time.Sleep(2 * time.Millisecond) // Ensure different timestamps
	}

	files := service.GetRecent()
	if len(files) != 5 {
		t.Errorf("Expected max 5 files, got %d", len(files))
	}

	// Most recent should be first (test_9.pdf)
	if len(files) > 0 && files[0].FileName != "test_9.pdf" {
		t.Errorf("Expected most recent file first, got %s", files[0].FileName)
	}

	// Oldest in list should be test_5.pdf
	if len(files) == 5 && files[4].FileName != "test_5.pdf" {
		t.Errorf("Expected test_5.pdf last, got %s", files[4].FileName)
	}
}

// TestAddRecent_Persistence tests that additions are persisted to disk
func TestAddRecent_Persistence(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.Startup(context.Background())

	service.AddRecent(testFile, 10)

	// Verify saved to disk
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read config file: %v", err)
	}

	var savedFiles []RecentFile
	if err := json.Unmarshal(data, &savedFiles); err != nil {
		t.Fatalf("Failed to parse saved data: %v", err)
	}

	if len(savedFiles) != 1 {
		t.Errorf("Expected 1 saved file, got %d", len(savedFiles))
	}
}

// TestGetRecent tests retrieving recent files
func TestGetRecent(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	service.AddRecent(testFile, 5)

	files := service.GetRecent()
	if len(files) != 1 {
		t.Fatalf("Expected 1 file, got %d", len(files))
	}

	// Verify it's a copy (modifying shouldn't affect internal state)
	files[0].PageCount = 999
	files2 := service.GetRecent()
	if files2[0].PageCount == 999 {
		t.Error("GetRecent did not return a copy")
	}
}

// TestGetRecent_FilterNonExistent tests that nonexistent files are filtered out
func TestGetRecent_FilterNonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	configDir := filepath.Join(tmpDir, "config")
	os.MkdirAll(configDir, 0755)
	configPath := filepath.Join(configDir, "recent.json")

	existingFile := filepath.Join(tmpDir, "exists.pdf")
	CreateTestPDF(t, existingFile, 1)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.Startup(context.Background())

	// Add both files using AddRecent
	service.AddRecent(existingFile, 1)

	// Manually create a config with a nonexistent file
	service.mu.Lock()
	service.files = []RecentFile{
		{FilePath: existingFile, FileName: "exists.pdf", PageCount: 1, LastOpened: time.Now()},
		{FilePath: "/nonexistent/file.pdf", FileName: "missing.pdf", PageCount: 1, LastOpened: time.Now()},
	}
	service.mu.Unlock()

	files := service.GetRecent()

	// Wait for any async saves
	time.Sleep(100 * time.Millisecond)

	// Should only return existing file
	if len(files) != 1 {
		t.Errorf("Expected 1 existing file, got %d", len(files))
	}
	if len(files) > 0 && files[0].FilePath != existingFile {
		t.Error("Wrong file returned")
	}
} // TestGetRecent_OrderByMostRecent tests that files are ordered by most recent first
func TestGetRecent_OrderByMostRecent(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	// Add files with different timestamps
	file1 := filepath.Join(tmpDir, "file1.pdf")
	file2 := filepath.Join(tmpDir, "file2.pdf")
	file3 := filepath.Join(tmpDir, "file3.pdf")
	CreateTestPDF(t, file1, 1)
	CreateTestPDF(t, file2, 1)
	CreateTestPDF(t, file3, 1)

	service.AddRecent(file1, 1)
	time.Sleep(5 * time.Millisecond)
	service.AddRecent(file2, 1)
	time.Sleep(5 * time.Millisecond)
	service.AddRecent(file3, 1)

	files := service.GetRecent()

	if len(files) < 3 {
		t.Fatalf("Expected 3 files, got %d", len(files))
	}

	// Most recent (file3) should be first
	if files[0].FileName != "file3.pdf" {
		t.Errorf("Expected file3.pdf first, got %s", files[0].FileName)
	}
	if files[1].FileName != "file2.pdf" {
		t.Errorf("Expected file2.pdf second, got %s", files[1].FileName)
	}
	if files[2].FileName != "file1.pdf" {
		t.Errorf("Expected file1.pdf third, got %s", files[2].FileName)
	}
}

// TestClearRecent tests clearing all recent files
func TestClearRecent(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	service.AddRecent(testFile, 5)

	if len(service.GetRecent()) != 1 {
		t.Fatal("File not added")
	}

	err := service.ClearRecent()
	if err != nil {
		t.Fatalf("ClearRecent failed: %v", err)
	}

	files := service.GetRecent()
	if len(files) != 0 {
		t.Errorf("Expected 0 files after clear, got %d", len(files))
	}

	// Verify cleared on disk
	data, _ := os.ReadFile(service.configPath)
	var savedFiles []RecentFile
	json.Unmarshal(data, &savedFiles)
	if len(savedFiles) != 0 {
		t.Error("Files not cleared on disk")
	}
}

// TestRemoveRecent tests removing a specific file
func TestRemoveRecent(t *testing.T) {
	tmpDir := t.TempDir()
	file1 := filepath.Join(tmpDir, "file1.pdf")
	file2 := filepath.Join(tmpDir, "file2.pdf")
	CreateTestPDF(t, file1, 1)
	CreateTestPDF(t, file2, 1)

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	service.AddRecent(file1, 1)
	service.AddRecent(file2, 1)

	if len(service.GetRecent()) != 2 {
		t.Fatal("Files not added")
	}

	err := service.RemoveRecent(file1)
	if err != nil {
		t.Fatalf("RemoveRecent failed: %v", err)
	}

	files := service.GetRecent()
	if len(files) != 1 {
		t.Errorf("Expected 1 file after removal, got %d", len(files))
	}
	if len(files) > 0 && files[0].FilePath != file2 {
		t.Error("Wrong file remained")
	}
}

// TestRemoveRecent_NonExistent tests removing a file that's not in the list
func TestRemoveRecent_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	err := service.RemoveRecent("/nonexistent/file.pdf")
	if err != nil {
		t.Errorf("RemoveRecent should not error for nonexistent file: %v", err)
	}
}

// TestLoad tests loading from disk
func TestLoad(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	// Create a config file
	files := []RecentFile{
		{FilePath: testFile, FileName: "test.pdf", PageCount: 5, LastOpened: time.Now()},
	}
	data, _ := json.Marshal(files)
	os.WriteFile(configPath, data, 0600)

	service := NewRecentFilesService()
	service.configPath = configPath

	err := service.load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if len(service.files) != 1 {
		t.Errorf("Expected 1 file after load, got %d", len(service.files))
	}
}

// TestLoad_FileNotExist tests loading when file doesn't exist
func TestLoad_FileNotExist(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "nonexistent.json")

	err := service.load()
	if err != nil {
		t.Errorf("Load should not error when file doesn't exist: %v", err)
	}
	if len(service.files) != 0 {
		t.Error("Files should be empty when no config file exists")
	}
}

// TestLoad_CorruptedFile tests handling of corrupted config file
func TestLoad_CorruptedFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")

	// Write invalid JSON
	os.WriteFile(configPath, []byte("invalid json {{{"), 0600)

	service := NewRecentFilesService()
	service.configPath = configPath

	err := service.load()
	if err == nil {
		t.Error("Expected error for corrupted config file")
	}
}

// TestSave tests saving to disk
func TestSave(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.files = []RecentFile{
		{FilePath: testFile, FileName: "test.pdf", PageCount: 5, LastOpened: time.Now()},
	}

	err := service.save()
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify saved correctly
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var loaded []RecentFile
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to parse saved data: %v", err)
	}

	if len(loaded) != 1 {
		t.Errorf("Expected 1 saved file, got %d", len(loaded))
	}
}

// TestConcurrentAccess tests thread-safe concurrent operations
func TestConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()

	service := NewRecentFilesService()
	service.configPath = filepath.Join(tmpDir, "recent.json")
	service.Startup(context.Background())

	var wg sync.WaitGroup
	const goroutines = 50

	wg.Add(goroutines * 2)

	// Concurrent writers
	for i := 0; i < goroutines; i++ {
		go func(id int) {
			defer wg.Done()
			testFile := filepath.Join(tmpDir, "test_"+string(rune('0'+id%10))+".pdf")
			CreateTestPDF(t, testFile, 1)
			service.AddRecent(testFile, id)
		}(i)
	}

	// Concurrent readers
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			service.GetRecent()
		}()
	}

	wg.Wait()

	// Verify service is still functional
	files := service.GetRecent()
	if files == nil {
		t.Error("Service corrupted after concurrent access")
	}
}

// TestFilePermissions tests that config file has correct permissions
func TestFilePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.Startup(context.Background())

	service.AddRecent(testFile, 1)

	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("Failed to stat config file: %v", err)
	}

	mode := info.Mode().Perm()
	expected := os.FileMode(0600)

	if mode != expected {
		t.Errorf("Config file has incorrect permissions: got %o, want %o", mode, expected)
	}
}

// TestDefaultMaxRecentFiles tests the default constant
func TestDefaultMaxRecentFiles(t *testing.T) {
	if DefaultMaxRecentFiles <= 0 {
		t.Error("DefaultMaxRecentFiles should be positive")
	}
	if DefaultMaxRecentFiles > 100 {
		t.Error("DefaultMaxRecentFiles seems unreasonably large")
	}
}

// TestSaveAsync tests async save doesn't block
func TestSaveAsync(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "recent.json")
	testFile := filepath.Join(tmpDir, "test.pdf")
	CreateTestPDF(t, testFile, 1)

	service := NewRecentFilesService()
	service.configPath = configPath
	service.Startup(context.Background())

	service.mu.Lock()
	service.files = []RecentFile{
		{FilePath: testFile, FileName: "test.pdf", PageCount: 1, LastOpened: time.Now()},
	}
	service.mu.Unlock()

	// Call saveAsync (it runs in background)
	service.saveAsync()

	// Give it time to complete
	time.Sleep(100 * time.Millisecond)

	// Verify it saved
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("saveAsync did not write file: %v", err)
	}

	var loaded []RecentFile
	json.Unmarshal(data, &loaded)
	if len(loaded) != 1 {
		t.Error("saveAsync did not save correctly")
	}
}
