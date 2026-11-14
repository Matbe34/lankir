package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// TestNewService tests service creation and initialization
func TestNewService(t *testing.T) {
	tmpDir := t.TempDir()

	service, err := NewServiceWithDir(tmpDir)
	if err != nil {
		t.Fatalf("NewServiceWithDir failed: %v", err)
	}

	if service == nil {
		t.Fatal("service is nil")
	}

	if service.config == nil {
		t.Fatal("service.config is nil")
	}

	if service.configPath == "" {
		t.Error("configPath not set")
	}

	// Verify config file was created
	if _, err := os.Stat(service.configPath); os.IsNotExist(err) {
		t.Error("config file was not created")
	}
}

// TestNewService_DirectoryCreation tests that config directory is created
func TestNewService_DirectoryCreation(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "config", "dir")

	_, err := NewServiceWithDir(nestedDir)
	if err != nil {
		t.Fatalf("NewServiceWithDir failed: %v", err)
	}

	// Verify nested directory was created
	if _, err := os.Stat(nestedDir); os.IsNotExist(err) {
		t.Error("nested config directory was not created")
	}
}

// TestNewService_LoadExisting tests loading existing config
func TestNewService_LoadExisting(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Create a config file manually
	existingConfig := &Config{
		Theme:             "light",
		AccentColor:       "#ff0000",
		DefaultZoom:       150,
		ShowLeftSidebar:   false,
		ShowRightSidebar:  true,
		DefaultViewMode:   "single",
		RecentFilesLength: 15,
		AutosaveInterval:  30,
		CertificateStores: []string{"/test/store"},
		TokenLibraries:    []string{"/test/lib.so"},
		DebugMode:         true,
		HardwareAccel:     false,
	}

	data, _ := json.MarshalIndent(existingConfig, "", "  ")
	if err := os.WriteFile(configPath, data, 0600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	service, err := NewServiceWithDir(tmpDir)
	if err != nil {
		t.Fatalf("NewServiceWithDir failed: %v", err)
	}

	cfg := service.Get()

	// Verify loaded values
	if cfg.Theme != "light" {
		t.Errorf("Expected theme 'light', got '%s'", cfg.Theme)
	}
	if cfg.DefaultZoom != 150 {
		t.Errorf("Expected zoom 150, got %d", cfg.DefaultZoom)
	}
	if cfg.ShowLeftSidebar != false {
		t.Error("ShowLeftSidebar should be false")
	}
	if cfg.DebugMode != true {
		t.Error("DebugMode should be true")
	}
	if len(cfg.CertificateStores) != 1 || cfg.CertificateStores[0] != "/test/store" {
		t.Error("CertificateStores not loaded correctly")
	}
}

// TestNewService_CorruptedConfig tests handling of corrupted config file
func TestNewService_CorruptedConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Write invalid JSON
	if err := os.WriteFile(configPath, []byte("invalid json {{{"), 0600); err != nil {
		t.Fatalf("Failed to write corrupted config: %v", err)
	}

	_, err := NewServiceWithDir(tmpDir)
	if err == nil {
		t.Error("Expected error when loading corrupted config")
	}
}

// TestDefaultConfig verifies default configuration values
func TestDefaultConfig(t *testing.T) {
	cfg := getDefaultConfig()

	if cfg.Theme != "dark" {
		t.Errorf("Default theme should be 'dark', got '%s'", cfg.Theme)
	}
	if cfg.AccentColor != "#007acc" {
		t.Errorf("Default accent color incorrect: %s", cfg.AccentColor)
	}
	if cfg.DefaultZoom != 100 {
		t.Errorf("Default zoom should be 100, got %d", cfg.DefaultZoom)
	}
	if cfg.ShowLeftSidebar {
		t.Error("Default ShowLeftSidebar should be false: the side panel opens only when asked")
	}
	if cfg.ShowRightSidebar {
		t.Error("Default ShowRightSidebar should be false")
	}
	if cfg.DefaultViewMode != "scroll" {
		t.Errorf("Default view mode should be 'scroll', got '%s'", cfg.DefaultViewMode)
	}
	if cfg.RecentFilesLength != 5 {
		t.Errorf("Default recent files should be 5, got %d", cfg.RecentFilesLength)
	}
	if cfg.AutosaveInterval != 0 {
		t.Errorf("Default autosave should be 0, got %d", cfg.AutosaveInterval)
	}
	if cfg.DebugMode {
		t.Error("Default debug mode should be false")
	}
	if !cfg.HardwareAccel {
		t.Error("Default hardware accel should be true")
	}
}

// TestGet tests thread-safe config retrieval
func TestGet(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	cfg := service.Get()
	if cfg == nil {
		t.Fatal("Get returned nil")
	}

	// Verify it's a copy (modifying shouldn't affect internal state)
	cfg.Theme = "modified"
	cfg.CertificateStores = append(cfg.CertificateStores, "/new/store")

	cfg2 := service.Get()
	if cfg2.Theme == "modified" {
		t.Error("Get did not return a copy, internal state was modified")
	}
	if len(cfg2.CertificateStores) != len(service.config.CertificateStores) {
		t.Error("Slice modifications affected internal state")
	}
}

// TestUpdate tests configuration update
func TestUpdate(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	newConfig := &Config{
		Theme:             "light",
		AccentColor:       "#00ff00",
		DefaultZoom:       125,
		ShowLeftSidebar:   false,
		ShowRightSidebar:  true,
		DefaultViewMode:   "single",
		RecentFilesLength: 10,
		AutosaveInterval:  60,
		CertificateStores: []string{"/updated/store"},
		TokenLibraries:    []string{"/updated/lib.so"},
		DebugMode:         true,
		HardwareAccel:     false,
	}

	if err := service.Update(newConfig); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify update was saved to disk
	data, err := os.ReadFile(service.configPath)
	if err != nil {
		t.Fatalf("Failed to read config file: %v", err)
	}

	var diskConfig Config
	if err := json.Unmarshal(data, &diskConfig); err != nil {
		t.Fatalf("Failed to parse saved config: %v", err)
	}

	if diskConfig.Theme != "light" {
		t.Error("Update not persisted to disk")
	}
	if diskConfig.DefaultZoom != 125 {
		t.Error("Zoom update not persisted")
	}
}

// TestReset tests configuration reset
func TestReset(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	// Modify config
	customConfig := service.Get()
	customConfig.Theme = "custom"
	customConfig.DefaultZoom = 200
	if err := service.Update(customConfig); err != nil {
		t.Fatal(err)
	}

	// Reset
	if err := service.Reset(); err != nil {
		t.Fatalf("Reset failed: %v", err)
	}

	// Verify reset to defaults
	cfg := service.Get()
	if cfg.Theme != "dark" {
		t.Errorf("Theme not reset to default, got '%s'", cfg.Theme)
	}
	if cfg.DefaultZoom != 100 {
		t.Errorf("Zoom not reset to default, got %d", cfg.DefaultZoom)
	}

	// Verify reset was persisted
	data, _ := os.ReadFile(service.configPath)
	var diskConfig Config
	if err := json.Unmarshal(data, &diskConfig); err != nil {
		t.Fatal(err)
	}
	if diskConfig.Theme != "dark" {
		t.Error("Reset not persisted to disk")
	}
}

// TestSaveAtomic tests atomic save operation
func TestSaveAtomic(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	// Save should be atomic (temp file + rename)
	cfg := service.Get()
	cfg.Theme = "atomic-test"

	if err := service.Update(cfg); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify temp file is cleaned up
	tmpFiles, _ := filepath.Glob(filepath.Join(tmpDir, "*.tmp"))
	if len(tmpFiles) > 0 {
		t.Error("Temporary files not cleaned up after save")
	}

	// Verify config file is valid
	data, _ := os.ReadFile(service.configPath)
	var loadedConfig Config
	if err := json.Unmarshal(data, &loadedConfig); err != nil {
		t.Errorf("Saved config is not valid JSON: %v", err)
	}
}

// TestConcurrentAccess tests thread-safe concurrent operations
func TestConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	const numGoroutines = 50
	const numOperations = 20

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 2) // readers and writers

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < numOperations; j++ {
				cfg := service.Get()
				_ = cfg.Theme // read
			}
		}()
	}

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < numOperations; j++ {
				cfg := service.Get()
				cfg.DefaultZoom = 100 + id
				if err := service.Update(cfg); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}

	wg.Wait()

	// Verify service is still functional
	cfg := service.Get()
	if cfg == nil {
		t.Error("Service corrupted after concurrent access")
	}
}

// TestLoad tests configuration loading
func TestLoad(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	// Modify config in memory
	service.config.Theme = "memory-only"

	// Load from disk (should restore persisted value)
	if err := service.Load(); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if service.config.Theme == "memory-only" {
		t.Error("Load did not restore from disk")
	}
}

// TestLoad_FileNotExist tests loading when file doesn't exist
func TestLoad_FileNotExist(t *testing.T) {
	tmpDir := t.TempDir()

	service := &Service{
		configPath: filepath.Join(tmpDir, "nonexistent.json"),
		config:     getDefaultConfig(),
	}

	err := service.Load()
	if err == nil {
		t.Error("Expected error when loading nonexistent file")
	}
	// Check if it's a path error containing "no such file"
	if err != nil && !os.IsNotExist(err) {
		// The error might be wrapped, check if it contains the path error
		if !strings.Contains(err.Error(), "no such file") {
			t.Errorf("Expected file not found error, got: %v", err)
		}
	}
} // TestSave tests configuration saving
func TestSave(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	service.config.Theme = "test-save"

	if err := service.Save(); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify saved correctly
	data, err := os.ReadFile(service.configPath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var loaded Config
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to parse saved config: %v", err)
	}

	if loaded.Theme != "test-save" {
		t.Error("Theme not saved correctly")
	}
}

// TestGetCertificatesDefaults tests certificate defaults generation
func TestGetCertificatesDefaults(t *testing.T) {
	certStores, tokenLibs := getCertificatesDefaults()

	// Should have some defaults
	if len(certStores) == 0 {
		t.Error("No default certificate stores returned")
	}

	if len(tokenLibs) == 0 {
		t.Error("No default token libraries returned")
	}

	// Verify paths are absolute
	for _, store := range certStores {
		if !filepath.IsAbs(store) {
			t.Errorf("Certificate store path not absolute: %s", store)
		}
	}

	for _, lib := range tokenLibs {
		if !filepath.IsAbs(lib) {
			t.Errorf("Token library path not absolute: %s", lib)
		}
	}
}

// TestCertificateStoresInitialization tests that certificate stores are populated
func TestCertificateStoresInitialization(t *testing.T) {
	tmpDir := t.TempDir()

	service, err := NewServiceWithDir(tmpDir)
	if err != nil {
		t.Fatalf("NewServiceWithDir failed: %v", err)
	}

	cfg := service.Get()

	// Should have default certificate stores
	if len(cfg.CertificateStores) == 0 {
		t.Error("CertificateStores not initialized with defaults")
	}

	// Should have default token libraries
	if len(cfg.TokenLibraries) == 0 {
		t.Error("TokenLibraries not initialized with defaults")
	}
}

// TestConfigPermissions tests that config file has correct permissions
func TestConfigPermissions(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	info, err := os.Stat(service.configPath)
	if err != nil {
		t.Fatalf("Failed to stat config file: %v", err)
	}

	mode := info.Mode().Perm()
	expected := os.FileMode(0600)

	if mode != expected {
		t.Errorf("Config file has incorrect permissions: got %o, want %o", mode, expected)
	}
}

// TestDirectoryPermissions tests that config directory has correct permissions
func TestDirectoryPermissions(t *testing.T) {
	tmpDir := t.TempDir()
	configDir := filepath.Join(tmpDir, "config")

	_, err := NewServiceWithDir(configDir)
	if err != nil {
		t.Fatalf("NewServiceWithDir failed: %v", err)
	}

	info, err := os.Stat(configDir)
	if err != nil {
		t.Fatalf("Failed to stat config directory: %v", err)
	}

	mode := info.Mode().Perm()
	expected := os.FileMode(0700)

	if mode != expected {
		t.Errorf("Config directory has incorrect permissions: got %o, want %o", mode, expected)
	}
}

// TestSlicesCopiedInGet tests that slices are properly copied in Get()
func TestSlicesCopiedInGet(t *testing.T) {
	tmpDir := t.TempDir()
	service, _ := NewServiceWithDir(tmpDir)

	cfg1 := service.Get()
	cfg1.CertificateStores = append(cfg1.CertificateStores, "/test1")
	cfg1.TokenLibraries = append(cfg1.TokenLibraries, "/lib1.so")

	cfg2 := service.Get()

	// Modifications to cfg1 slices should not affect cfg2
	hasTest1 := false
	for _, store := range cfg2.CertificateStores {
		if store == "/test1" {
			hasTest1 = true
			break
		}
	}

	if hasTest1 {
		t.Error("CertificateStores slice not properly copied")
	}

	hasLib1 := false
	for _, lib := range cfg2.TokenLibraries {
		if lib == "/lib1.so" {
			hasLib1 = true
			break
		}
	}

	if hasLib1 {
		t.Error("TokenLibraries slice not properly copied")
	}
}

func TestSigningSettingsPersist(t *testing.T) {
	dir := t.TempDir()
	s, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	c := s.Get()
	if c.TSAURL != "" || c.SignatureLocationLookup {
		t.Fatalf("defaults: want no TSA and no location lookup, got %q %v", c.TSAURL, c.SignatureLocationLookup)
	}
	c.TSAURL = "http://tsa.example"
	c.SignatureLocationLookup = true
	if err := s.Update(c); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLastSigning("abc", "00000000-0000-0000-0000-000000000002"); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"tsaUrl"`, `"signatureLocationLookup"`, `"lastCertificateFingerprint"`, `"lastSignatureProfileId"`} {
		if !strings.Contains(string(data), key) {
			t.Errorf("config.json lacks %s", key)
		}
	}

	reloaded, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := *reloaded.Get(); got.TSAURL != c.TSAURL || !got.SignatureLocationLookup ||
		got.LastCertificateFingerprint != "abc" || got.LastSignatureProfileID != "00000000-0000-0000-0000-000000000002" {
		t.Fatalf("reloaded config lost signing settings: %+v", got)
	}
}

func TestSetLastSigningKeepsSettingsSavedElsewhere(t *testing.T) {
	dir := t.TempDir()
	s, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Another window saves its settings after this service loaded.
	other, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	c := other.Get()
	c.Theme = "light"
	c.TSAURL = "http://tsa.example"
	if err := other.Update(c); err != nil {
		t.Fatal(err)
	}

	if err := s.SetLastSigning("fp", "profile"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get()
	if got.Theme != "light" || got.TSAURL != "http://tsa.example" {
		t.Errorf("settings saved elsewhere were overwritten: %+v", got)
	}
	if got.LastCertificateFingerprint != "fp" || got.LastSignatureProfileID != "profile" {
		t.Errorf("last signing not saved: %+v", got)
	}
	if s.Get().Theme != "light" {
		t.Error("the service should now hold the settings it saved")
	}
}

// The last-used signing fields are owned by Go (SetLastSigning); a Settings save from
// a window holding an older copy must not roll them back.
func TestUpdateKeepsLastSigningFromDisk(t *testing.T) {
	dir := t.TempDir()
	window, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	stale := window.Get()

	signer, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := signer.SetLastSigning("fp-new", "profile-new"); err != nil {
		t.Fatal(err)
	}

	stale.Theme = "light"
	if err := window.Update(stale); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get()
	if got.Theme != "light" || got.LastCertificateFingerprint != "fp-new" || got.LastSignatureProfileID != "profile-new" {
		t.Fatalf("got theme=%q fp=%q profile=%q", got.Theme, got.LastCertificateFingerprint, got.LastSignatureProfileID)
	}
}

func TestCheckRevocationOnlineDefaultsOn(t *testing.T) {
	dir := t.TempDir()
	s, err := NewServiceWithDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Get().CheckRevocationOnline {
		t.Fatal("new config: want online revocation checks on")
	}

	// A config saved before the setting existed lacks the key.
	old := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(old, []byte(`{"theme":"light","signatureLocationLookup":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err = NewServiceWithDir(filepath.Dir(old))
	if err != nil {
		t.Fatal(err)
	}
	if !s.Get().CheckRevocationOnline {
		t.Fatal("config without the key: want online revocation checks on")
	}

	c := s.Get()
	c.CheckRevocationOnline = false
	if err := s.Update(c); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewServiceWithDir(filepath.Dir(old))
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Get().CheckRevocationOnline {
		t.Fatal("turned off: want it to stay off after reload")
	}
}
