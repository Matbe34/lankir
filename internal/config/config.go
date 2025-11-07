package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Config represents application configuration
type Config struct {
	// Appearance settings
	Theme       string `json:"theme"`
	AccentColor string `json:"accentColor"`

	// Viewer settings
	DefaultZoom      int    `json:"defaultZoom"`
	ShowLeftSidebar  bool   `json:"showLeftSidebar"`
	ShowRightSidebar bool   `json:"showRightSidebar"`
	DefaultViewMode  string `json:"defaultViewMode"` // "single" or "scroll"

	// File settings
	RecentFilesLength int `json:"recentFilesLength"`
	AutosaveInterval  int `json:"autosaveInterval"`

	// Certificate settings
	CertificateStores []string `json:"certificateStores"`
	TokenLibraries    []string `json:"tokenLibraries"`

	// Advanced settings
	DebugMode     bool `json:"debugMode"`
	HardwareAccel bool `json:"hardwareAccel"`
}

// Service manages application configuration
type Service struct {
	mu         sync.RWMutex
	config     *Config
	configPath string
}

// NewService creates a new configuration service
func NewService() (*Service, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configDir := filepath.Join(homeDir, ".config", "pdf-editor-pro")
	os.MkdirAll(configDir, 0755)

	service := &Service{
		configPath: filepath.Join(configDir, "config.json"),
		config:     getDefaultConfig(),
	}

	// Load existing config or create default
	if err := service.Load(); err != nil {
		// If file doesn't exist, save default config
		if os.IsNotExist(err) {
			service.Save()
		}
	}

	return service, nil
}

// getDefaultConfig returns default configuration
func getDefaultConfig() *Config {
	return &Config{
		Theme:             "dark",
		AccentColor:       "#007acc",
		DefaultZoom:       100,
		ShowLeftSidebar:   true,
		ShowRightSidebar:  false,
		DefaultViewMode:   "scroll",
		RecentFilesLength: 5,
		AutosaveInterval:  0,
		CertificateStores: []string{},
		TokenLibraries:    []string{},
		DebugMode:         false,
		HardwareAccel:     true,
	}
}

// Load reads configuration from disk
func (s *Service) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		return err
	}

	config := getDefaultConfig()
	if err := json.Unmarshal(data, config); err != nil {
		return err
	}

	s.config = config
	return nil
}

// Save writes configuration to disk
func (s *Service) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.configPath, data, 0644)
}

// Get returns the current configuration
func (s *Service) Get() *Config {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Return a copy to prevent external modification
	configCopy := *s.config
	return &configCopy
}

// Update updates the configuration and saves it
func (s *Service) Update(config *Config) error {
	s.mu.Lock()
	s.config = config
	s.mu.Unlock()

	return s.Save()
}

// Reset resets configuration to defaults
func (s *Service) Reset() error {
	s.mu.Lock()
	s.config = getDefaultConfig()
	s.mu.Unlock()

	return s.Save()
}
