package pdf

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
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
	ctx        context.Context
	configPath string
	files      []RecentFile
	maxRecent  int
}

// NewRecentFilesService creates a new recent files service
func NewRecentFilesService() *RecentFilesService {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".config", "pdf-editor-pro")
	os.MkdirAll(configDir, 0755)

	return &RecentFilesService{
		configPath: filepath.Join(configDir, "recent.json"),
		files:      []RecentFile{},
		maxRecent:  10,
	}
}

// Startup is called when the app starts
func (s *RecentFilesService) Startup(ctx context.Context) {
	s.ctx = ctx
	s.load()
}

// AddRecent adds a file to the recent files list
func (s *RecentFilesService) AddRecent(filePath string, pageCount int) error {
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

// GetRecent returns the list of recent files
func (s *RecentFilesService) GetRecent() []RecentFile {
	// Filter out files that no longer exist
	validFiles := []RecentFile{}
	for _, f := range s.files {
		if _, err := os.Stat(f.FilePath); err == nil {
			validFiles = append(validFiles, f)
		}
	}

	if len(validFiles) != len(s.files) {
		s.files = validFiles
		s.save()
	}

	return s.files
}

// ClearRecent clears all recent files
func (s *RecentFilesService) ClearRecent() error {
	s.files = []RecentFile{}
	return s.save()
}

// RemoveRecent removes a specific file from recent files list
func (s *RecentFilesService) RemoveRecent(filePath string) error {
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
	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No recent files yet
		}
		return err
	}

	return json.Unmarshal(data, &s.files)
}

// save writes the recent files to disk
func (s *RecentFilesService) save() error {
	data, err := json.Marshal(s.files)
	if err != nil {
		return err
	}

	return os.WriteFile(s.configPath, data, 0644)
}
