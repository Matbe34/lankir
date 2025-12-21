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

// RecentFilesService tracks recently opened PDF files with persistence.
type RecentFilesService struct {
	mu         sync.RWMutex
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
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
	configDir := filepath.Join(homeDir, ".config", "lankir")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		slog.Warn("failed to create config directory", "error", err, "path", configDir)
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &RecentFilesService{
		ctx:        ctx,
		cancel:     cancel,
		configPath: filepath.Join(configDir, "recent.json"),
		files:      []RecentFile{},
		maxRecent:  DefaultMaxRecentFiles,
	}
}

// Startup loads persisted recent files. Called by Wails on app start.
func (s *RecentFilesService) Startup(ctx context.Context) {
	s.ctx = ctx
	s.load()
}

// AddRecent adds or moves a file to the top of the recent files list.
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

// GetRecent returns recent files, automatically removing entries for deleted files.
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
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.saveAsync()
		}()
	}

	result := make([]RecentFile, len(s.files))
	copy(result, s.files)
	return result
}

// ClearRecent removes all entries from the recent files list.
func (s *RecentFilesService) ClearRecent() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.files = []RecentFile{}
	return s.save()
}

// RemoveRecent removes a specific file from the recent files list.
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
	select {
	case <-s.ctx.Done():
		slog.Debug("saveAsync cancelled due to context")
		return
	default:
	}

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

// Shutdown waits for pending saves to complete with the given timeout.
func (s *RecentFilesService) Shutdown(timeout time.Duration) error {
	s.cancel()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("shutdown timeout after %v", timeout)
	}
}
