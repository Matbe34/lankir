package signature

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Matbe34/lankir/internal/config"
	"github.com/google/uuid"
)

// TestNewSignatureService tests service creation
func TestNewSignatureService(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)

	service := NewSignatureService(cfgService)

	if service == nil {
		t.Fatal("NewSignatureService returned nil")
	}
	if service.configService != cfgService {
		t.Error("configService not set correctly")
	}
	if service.profileManager == nil {
		t.Error("profileManager not initialized")
	}
}

// TestNewSignatureService_NilConfig tests creation with nil config
func TestNewSignatureService_NilConfig(t *testing.T) {
	service := NewSignatureService(nil)

	if service == nil {
		t.Fatal("NewSignatureService returned nil with nil config")
	}
	if service.profileManager == nil {
		t.Error("profileManager should still be initialized")
	}
}

// TestSignatureServiceStartup tests service startup
func TestSignatureServiceStartup(t *testing.T) {
	service := NewSignatureService(nil)
	ctx := context.Background()

	service.Startup(ctx)

	if service.ctx == nil {
		t.Error("Context not set after Startup")
	}
	if service.ctx != ctx {
		t.Error("Context not set correctly")
	}
} // TestListSignatureProfiles tests profile listing
func TestListSignatureProfiles(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	profiles, err := service.ListSignatureProfiles()
	if err != nil {
		t.Fatalf("ListSignatureProfiles failed: %v", err)
	}

	if len(profiles) == 0 {
		t.Error("Expected at least default profiles")
	}

	// Should have invisible and visible defaults
	hasInvisible := false
	hasVisible := false
	for _, p := range profiles {
		if p.Visibility == VisibilityInvisible {
			hasInvisible = true
		}
		if p.Visibility == VisibilityVisible {
			hasVisible = true
		}
	}

	if !hasInvisible {
		t.Error("Missing default invisible profile")
	}
	if !hasVisible {
		t.Error("Missing default visible profile")
	}
}

// TestGetSignatureProfile tests retrieving profile by ID
func TestGetSignatureProfile(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	// Get default invisible profile ID
	invisibleID := "00000000-0000-0000-0000-000000000001"

	profile, err := service.GetSignatureProfile(invisibleID)
	if err != nil {
		t.Fatalf("GetSignatureProfile failed: %v", err)
	}

	if profile == nil {
		t.Fatal("profile is nil")
	}
	if profile.ID.String() != invisibleID {
		t.Error("Wrong profile returned")
	}
	if profile.Visibility != VisibilityInvisible {
		t.Error("Profile has wrong visibility")
	}
}

// TestGetSignatureProfile_InvalidID tests invalid profile ID
func TestGetSignatureProfile_InvalidID(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	_, err := service.GetSignatureProfile("invalid-uuid")
	if err == nil {
		t.Error("Expected error for invalid UUID")
	}
}

// TestGetSignatureProfile_NonExistent tests getting nonexistent profile
func TestGetSignatureProfile_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	randomID := uuid.New().String()
	_, err := service.GetSignatureProfile(randomID)
	if err == nil {
		t.Error("Expected error for nonexistent profile")
	}
}

// TestGetDefaultSignatureProfile tests getting default profile
func TestGetDefaultSignatureProfile(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	profile, err := service.GetDefaultSignatureProfile()
	if err != nil {
		t.Fatalf("GetDefaultSignatureProfile failed: %v", err)
	}

	if profile == nil {
		t.Fatal("default profile is nil")
	}
	if !profile.IsDefault {
		t.Error("Profile not marked as default")
	}
	// Note: Default profile type may vary depending on implementation
	// Just verify it exists and is marked as default
} // TestSaveSignatureProfile tests saving a profile
func TestSaveSignatureProfile(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	newProfile := &SignatureProfile{
		ID:          uuid.New(),
		Name:        "Test Profile",
		Description: "Test description",
		Visibility:  VisibilityInvisible,
		IsDefault:   false,
	}

	err := service.SaveSignatureProfile(newProfile)
	if err != nil {
		t.Fatalf("SaveSignatureProfile failed: %v", err)
	}

	// Verify it was saved
	loaded, err := service.GetSignatureProfile(newProfile.ID.String())
	if err != nil {
		t.Fatalf("Failed to load saved profile: %v", err)
	}

	if loaded.Name != newProfile.Name {
		t.Error("Saved profile has wrong name")
	}
	if loaded.Description != newProfile.Description {
		t.Error("Saved profile has wrong description")
	}
}

// TestSaveSignatureProfile_InvalidProfile tests validation
func TestSaveSignatureProfile_InvalidProfile(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	// Profile without ID
	invalidProfile := &SignatureProfile{
		Name:       "Invalid",
		Visibility: VisibilityInvisible,
	}

	err := service.SaveSignatureProfile(invalidProfile)
	if err == nil {
		t.Error("Expected error for invalid profile")
	}
}

// TestDeleteSignatureProfile tests profile deletion
func TestDeleteSignatureProfile(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	// Create and save a profile
	profile := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "To Delete",
		Visibility: VisibilityInvisible,
	}
	service.SaveSignatureProfile(profile)

	// Delete it
	err := service.DeleteSignatureProfile(profile.ID.String())
	if err != nil {
		t.Fatalf("DeleteSignatureProfile failed: %v", err)
	}

	// Verify it's gone
	_, err = service.GetSignatureProfile(profile.ID.String())
	if err == nil {
		t.Error("Profile still exists after deletion")
	}
}

// TestDeleteSignatureProfile_InvalidID tests deletion with invalid ID
func TestDeleteSignatureProfile_InvalidID(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	err := service.DeleteSignatureProfile("invalid-uuid")
	if err == nil {
		t.Error("Expected error for invalid UUID")
	}
}

// TestValidateCertificateStorePath tests certificate store path validation
func TestValidateCertificateStorePath(t *testing.T) {
	homeDir, _ := os.UserHomeDir()

	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"empty path", "", true},
		{"relative path", "relative/path", true},
		{"user home subdir", filepath.Join(homeDir, "test"), false},
		{"system cert dir", "/etc/ssl/certs", false},
		{"invalid location", "/tmp/random", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create the directory if it's a valid test case
			if !tt.wantErr && tt.path != "/etc/ssl/certs" {
				os.MkdirAll(tt.path, 0755)
				defer os.RemoveAll(tt.path)
			}

			err := validateCertificateStorePath(tt.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateCertificateStorePath() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// TestValidateCertificateStorePath_FileNotDirectory tests that files are rejected
func TestValidateCertificateStorePath_FileNotDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	homeDir, _ := os.UserHomeDir()
	testFile := filepath.Join(homeDir, filepath.Base(tmpDir), "file.txt")

	os.MkdirAll(filepath.Dir(testFile), 0755)
	defer os.RemoveAll(filepath.Dir(testFile))

	os.WriteFile(testFile, []byte("test"), 0644)

	err := validateCertificateStorePath(testFile)
	if err == nil {
		t.Error("Expected error for file path (not directory)")
	}
}

// TestAddCertificateStore tests adding certificate store
func TestAddCertificateStore(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	homeDir, _ := os.UserHomeDir()
	testStore := filepath.Join(homeDir, filepath.Base(tmpDir))
	os.MkdirAll(testStore, 0755)
	defer os.RemoveAll(testStore)

	err := service.AddCertificateStore(testStore)
	if err != nil {
		t.Fatalf("AddCertificateStore failed: %v", err)
	}

	// Verify it was added to config
	cfg := cfgService.Get()
	found := false
	for _, store := range cfg.CertificateStores {
		if store == testStore {
			found = true
			break
		}
	}

	if !found {
		t.Error("Certificate store not added to config")
	}
}

// TestAddCertificateStore_Duplicate tests adding duplicate store
func TestAddCertificateStore_Duplicate(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	homeDir, _ := os.UserHomeDir()
	testStore := filepath.Join(homeDir, filepath.Base(tmpDir))
	os.MkdirAll(testStore, 0755)
	defer os.RemoveAll(testStore)

	service.AddCertificateStore(testStore)

	err := service.AddCertificateStore(testStore)
	if err == nil {
		t.Error("Expected error for duplicate certificate store")
	}
}

// TestAddCertificateStore_InvalidPath tests adding invalid path
func TestAddCertificateStore_InvalidPath(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	err := service.AddCertificateStore("/invalid/path")
	if err == nil {
		t.Error("Expected error for invalid path")
	}
}

// TestRemoveCertificateStore tests removing certificate store
func TestRemoveCertificateStore(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	homeDir, _ := os.UserHomeDir()
	testStore := filepath.Join(homeDir, filepath.Base(tmpDir))
	os.MkdirAll(testStore, 0755)
	defer os.RemoveAll(testStore)

	service.AddCertificateStore(testStore)

	err := service.RemoveCertificateStore(testStore)
	if err != nil {
		t.Fatalf("RemoveCertificateStore failed: %v", err)
	}

	// Verify it was removed from config
	cfg := cfgService.Get()
	for _, store := range cfg.CertificateStores {
		if store == testStore {
			t.Error("Certificate store not removed from config")
		}
	}
}

// TestRemoveCertificateStore_NonExistent tests removing nonexistent store
func TestRemoveCertificateStore_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	err := service.RemoveCertificateStore("/nonexistent/store")
	if err == nil {
		t.Error("Expected error for nonexistent store")
	}
}

// TestValidateTokenLibraryPath tests token library path validation
func TestValidateTokenLibraryPath(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"empty path", "", true},
		{"relative path", "relative/lib.so", true},
		{"valid .so", "/usr/lib/test.so", false},
		{"valid .dylib", "/usr/lib/test.dylib", false},
		{"directory not file", "/usr/lib", true},
		{"no extension", "/usr/lib/test", true},
		{"wrong extension", "/usr/lib/test.txt", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// For file tests, we can't easily create them, so we'll accept errors
			// The test mainly validates the validation logic
			err := validateTokenLibraryPath(tt.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateTokenLibraryPath() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// TestAddTokenLibrary tests adding token library
func TestAddTokenLibrary(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	// Create a test .so file
	testLib := filepath.Join(tmpDir, "test.so")
	os.WriteFile(testLib, []byte("fake lib"), 0755)

	err := service.AddTokenLibrary(testLib)
	if err != nil {
		t.Fatalf("AddTokenLibrary failed: %v", err)
	}

	// Verify it was added to config
	cfg := cfgService.Get()
	found := false
	for _, lib := range cfg.TokenLibraries {
		if lib == testLib {
			found = true
			break
		}
	}

	if !found {
		t.Error("Token library not added to config")
	}
}

// TestAddTokenLibrary_Duplicate tests adding duplicate library
func TestAddTokenLibrary_Duplicate(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	testLib := filepath.Join(tmpDir, "test.so")
	os.WriteFile(testLib, []byte("fake lib"), 0755)

	service.AddTokenLibrary(testLib)

	err := service.AddTokenLibrary(testLib)
	if err == nil {
		t.Error("Expected error for duplicate token library")
	}
}

// TestRemoveTokenLibrary tests removing token library
func TestRemoveTokenLibrary(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	testLib := filepath.Join(tmpDir, "test.so")
	os.WriteFile(testLib, []byte("fake lib"), 0755)

	service.AddTokenLibrary(testLib)

	err := service.RemoveTokenLibrary(testLib)
	if err != nil {
		t.Fatalf("RemoveTokenLibrary failed: %v", err)
	}

	// Verify it was removed from config
	cfg := cfgService.Get()
	for _, lib := range cfg.TokenLibraries {
		if lib == testLib {
			t.Error("Token library not removed from config")
		}
	}
}

// TestRemoveTokenLibrary_NonExistent tests removing nonexistent library
func TestRemoveTokenLibrary_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	err := service.RemoveTokenLibrary("/nonexistent/lib.so")
	if err == nil {
		t.Error("Expected error for nonexistent library")
	}
}

// TestGetDefaultCertificateSources tests default certificate sources
func TestGetDefaultCertificateSources(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	sources := service.GetDefaultCertificateSources()

	if sources == nil {
		t.Fatal("sources is nil")
	}

	if _, ok := sources["system"]; !ok {
		t.Error("Missing 'system' sources")
	}
	if _, ok := sources["user"]; !ok {
		t.Error("Missing 'user' sources")
	}

	systemSources := sources["system"]
	if len(systemSources) == 0 {
		t.Error("No system certificate sources")
	}

	// All paths should be absolute
	for _, path := range systemSources {
		if !filepath.IsAbs(path) {
			t.Errorf("System source path not absolute: %s", path)
		}
	}
}

// TestGetDefaultTokenLibraries tests default token libraries
func TestGetDefaultTokenLibraries(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	libs := service.GetDefaultTokenLibraries()

	if libs == nil {
		t.Fatal("libs is nil")
	}

	if len(libs) == 0 {
		t.Error("No default token libraries")
	}

	// All paths should be absolute
	for _, lib := range libs {
		if !filepath.IsAbs(lib) {
			t.Errorf("Token library path not absolute: %s", lib)
		}
	}
}

// TestListCertificates tests certificate listing
func TestListCertificates(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	// This will try to load from configured stores
	// In a clean test environment, it might not find any
	certs, err := service.ListCertificates()
	if err != nil {
		t.Fatalf("ListCertificates failed: %v", err)
	}

	// Should return empty slice, not nil
	if certs == nil {
		t.Error("certs should not be nil")
	}
}

// TestListCertificatesFiltered tests filtered certificate listing
func TestListCertificatesFiltered(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	filter := CertificateFilter{
		ValidOnly: true,
		Search:    "test",
	}

	certs, err := service.ListCertificatesFiltered(filter)
	if err != nil {
		t.Fatalf("ListCertificatesFiltered failed: %v", err)
	}

	if certs == nil {
		t.Error("certs should not be nil")
	}
}

// TestSearchCertificates tests certificate search
func TestSearchCertificates(t *testing.T) {
	tmpDir := t.TempDir()
	cfgService, _ := config.NewServiceWithDir(tmpDir)
	service := NewSignatureService(cfgService)

	certs, err := service.SearchCertificates("test")
	if err != nil {
		t.Fatalf("SearchCertificates failed: %v", err)
	}

	if certs == nil {
		t.Error("certs should not be nil")
	}
}
