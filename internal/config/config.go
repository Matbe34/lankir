package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/Matbe34/lankir/internal/signature/pkcs11"
	"github.com/Matbe34/lankir/internal/signature/pkcs12"
)

// Config holds all application settings persisted to disk.
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

	// Signing settings
	TSAURL                  string `json:"tsaUrl"`
	SignatureLocationLookup bool   `json:"signatureLocationLookup"`
	// CheckRevocationOnline asks the OCSP/CRL servers a signer's certificate
	// names whether it was revoked, when verifying signatures.
	CheckRevocationOnline      bool   `json:"checkRevocationOnline"`
	LastCertificateFingerprint string `json:"lastCertificateFingerprint"`
	LastSignatureProfileID     string `json:"lastSignatureProfileId"`

	// Advanced settings
	DebugMode     bool `json:"debugMode"`
	HardwareAccel bool `json:"hardwareAccel"`
}

// Service provides thread-safe access to application configuration.
type Service struct {
	mu         sync.RWMutex
	config     *Config
	configPath string
}

// NewService creates a config service using the default config directory.
func NewService() (*Service, error) {
	// Linux: $XDG_CONFIG_HOME/lankir or ~/.config/lankir
	// Windows: %APPDATA%\lankir (C:\Users\<user>\AppData\Roaming\lankir)
	// macOS: ~/Library/Application Support/lankir
	configDir, err := Dir()
	if err != nil {
		return nil, err
	}
	return NewServiceWithDir(configDir)
}

// NewServiceWithDir creates a config service using a custom directory.
func NewServiceWithDir(configDir string) (*Service, error) {
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create config directory: %w", err)
	}

	service := &Service{
		configPath: filepath.Join(configDir, "config.json"),
		config:     getDefaultConfig(),
	}

	if err := service.Load(); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("failed to load config: %w", err)
		}
		if err := service.Save(); err != nil {
			return nil, fmt.Errorf("failed to save default config: %w", err)
		}
	}

	certStores, tokenLibs := getCertificatesDefaults()
	configChanged := false

	if len(service.config.CertificateStores) == 0 {
		service.config.CertificateStores = certStores
		configChanged = true
	}
	if len(service.config.TokenLibraries) == 0 {
		service.config.TokenLibraries = tokenLibs
		configChanged = true
	}

	if configChanged {
		if err := service.Save(); err != nil {
			return nil, fmt.Errorf("failed to save configuration defaults: %w", err)
		}
	}

	return service, nil
}

// getDefaultConfig returns default configuration
func getDefaultConfig() *Config {
	return &Config{
		Theme:                 "dark",
		AccentColor:           "#007acc",
		DefaultZoom:           100,
		ShowLeftSidebar:       false,
		ShowRightSidebar:      false,
		DefaultViewMode:       "scroll",
		RecentFilesLength:     5,
		AutosaveInterval:      0,
		CertificateStores:     []string{},
		TokenLibraries:        []string{},
		CheckRevocationOnline: true,
		DebugMode:             false,
		HardwareAccel:         true,
	}
}

// Load reads configuration from disk into memory.
func (s *Service) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config, err := s.read()
	if err != nil {
		return err
	}
	s.config = config
	return nil
}

func (s *Service) read() (*Config, error) {
	data, err := os.ReadFile(s.configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	config := getDefaultConfig()
	if err := json.Unmarshal(data, config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}
	return config, nil
}

// SetLastSigning saves the certificate and profile of the last signature.
// It changes only those two fields of config.json as it is on disk, so
// settings another window saved since Load are kept.
func (s *Service) SetLastSigning(certFingerprint, profileID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config, err := s.read()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		config = s.config
	}
	config.LastCertificateFingerprint = certFingerprint
	config.LastSignatureProfileID = profileID
	s.config = config
	return s.saveUnlocked()
}

// Save writes the current configuration to disk atomically.
func (s *Service) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.saveUnlocked()
}

// saveUnlocked writes configuration to disk without acquiring the lock
// Must be called with the lock already held
func (s *Service) saveUnlocked() error {
	data, err := json.MarshalIndent(s.config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	tmpPath := s.configPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return fmt.Errorf("failed to write temp config: %w", err)
	}

	if err := os.Rename(tmpPath, s.configPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// Get returns a copy of the current configuration.
func (s *Service) Get() *Config {
	s.mu.RLock()
	defer s.mu.RUnlock()

	configCopy := *s.config
	configCopy.CertificateStores = append([]string(nil), s.config.CertificateStores...)
	configCopy.TokenLibraries = append([]string(nil), s.config.TokenLibraries...)
	return &configCopy
}

// Update replaces the configuration and saves it to disk.
func (s *Service) Update(config *Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Last-used signing fields are written only by SetLastSigning; keep what is on disk.
	if onDisk, err := s.read(); err == nil {
		config.LastCertificateFingerprint = onDisk.LastCertificateFingerprint
		config.LastSignatureProfileID = onDisk.LastSignatureProfileID
	}
	s.config = config
	return s.saveUnlocked()
}

// Reset restores default settings and saves to disk.
func (s *Service) Reset() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.config = getDefaultConfig()
	return s.saveUnlocked()
}

// getCertificatesDefaults returns default certificate stores and token libraries paths
func getCertificatesDefaults() ([]string, []string) {
	certificateStorePaths := []string{}
	tokenLibraryPaths := []string{}

	certificateStorePaths = append(certificateStorePaths, pkcs12.DefaultSystemCertDirs...)

	homeDir, err := os.UserHomeDir()
	if err == nil {
		for _, relDir := range pkcs12.DefaultUserCertDirs {
			certificateStorePaths = append(certificateStorePaths, filepath.Join(homeDir, relDir))
		}
	}

	tokenLibraryPaths = append(tokenLibraryPaths, pkcs11.DefaultModules...)

	return certificateStorePaths, tokenLibraryPaths
}
