package pdf

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	DefaultMaxRecentFiles = 20
)

// RecentFile represents a recently opened PDF file
type RecentFile struct {
	FilePath   string    `json:"filePath"`
	FileName   string    `json:"fileName"`
	LastOpened time.Time `json:"lastOpened"`
	PageCount  int       `json:"pageCount"`
}

// RecentFilesService manages recently opened files
type RecentFilesService struct {
	mu         sync.RWMutex
	ctx        context.Context
	configPath string
	files      []RecentFile
	maxRecent  int
}

// NewRecentFilesService creates a new recent files service
func NewRecentFilesService() *RecentFilesService {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	configDir := filepath.Join(homeDir, ".config", "pdf_app")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		slog.Warn("failed to create config directory", "error", err, "path", configDir)
	}

	return &RecentFilesService{
		configPath: filepath.Join(configDir, "recent.json"),
		files:      []RecentFile{},
		maxRecent:  DefaultMaxRecentFiles,
	}
}

// Startup is called when the app starts
func (s *RecentFilesService) Startup(ctx context.Context) {
	s.ctx = ctx
	s.load()
}

// AddRecent adds a file to the recent files list
func (s *RecentFilesService) AddRecent(filePath string, pageCount int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove if already exists
	for i, f := range s.files {
		if f.FilePath == filePath {
			s.files = append(s.files[:i], s.files[i+1:]...)
			break
		}
	}

	// Add to the beginning
	recent := RecentFile{
		FilePath:   filePath,
		FileName:   filepath.Base(filePath),
		LastOpened: time.Now(),
		PageCount:  pageCount,
	}

	s.files = append([]RecentFile{recent}, s.files...)

	// Keep only max recent files
	if len(s.files) > s.maxRecent {
		s.files = s.files[:s.maxRecent]
	}

	return s.save()
}

// GetRecent returns the list of recent files, filtering out files that no longer exist
func (s *RecentFilesService) GetRecent() []RecentFile {
	s.mu.Lock()
	defer s.mu.Unlock()

	validFiles := []RecentFile{}
	filesChanged := false

	for _, f := range s.files {
		if _, err := os.Stat(f.FilePath); err == nil {
			validFiles = append(validFiles, f)
		} else {
			filesChanged = true
		}
	}

	if filesChanged {
		s.files = validFiles
		go s.saveAsync()
	}

	result := make([]RecentFile, len(s.files))
	copy(result, s.files)
	return result
}

// ClearRecent clears all recent files
func (s *RecentFilesService) ClearRecent() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.files = []RecentFile{}
	return s.save()
}

// RemoveRecent removes a specific file from recent files list
func (s *RecentFilesService) RemoveRecent(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, f := range s.files {
		if f.FilePath == filePath {
			s.files = append(s.files[:i], s.files[i+1:]...)
			return s.save()
		}
	}
	return nil // File not found, no error
}

// load reads the recent files from disk
func (s *RecentFilesService) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No recent files yet
		}
		return fmt.Errorf("failed to read recent files: %w", err)
	}

	if err := json.Unmarshal(data, &s.files); err != nil {
		return fmt.Errorf("failed to parse recent files: %w", err)
	}

	return nil
}

// save writes the recent files to disk
func (s *RecentFilesService) save() error {
	data, err := json.Marshal(s.files)
	if err != nil {
		return err
	}

	return os.WriteFile(s.configPath, data, 0600)
}

// saveAsync saves the recent files in the background without holding locks
// This is called from a goroutine and handles its own error logging
func (s *RecentFilesService) saveAsync() {
	s.mu.RLock()
	data, err := json.Marshal(s.files)
	s.mu.RUnlock()

	if err != nil {
		slog.Error("failed to marshal recent files", "error", err)
		return
	}

	if err := os.WriteFile(s.configPath, data, 0600); err != nil {
		slog.Error("failed to save recent files", "error", err)
	}
}
