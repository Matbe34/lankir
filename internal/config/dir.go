package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

// Names of the files kept next to config.json.
const (
	ProfilesDirName = "signature_profiles"
	RecentFilesName = "recent.json"
)

// Dir returns the folder that holds config.json, the signature profiles and
// the recent files: lankir under the user config dir, which on Linux follows
// XDG_CONFIG_HOME. Lankir 1.0 kept the profiles and recent files in
// ~/.config/lankir whatever XDG_CONFIG_HOME said; when Dir is elsewhere and
// has none of them yet, they are copied over. The originals stay.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config directory: %w", err)
	}
	dir := filepath.Join(base, "lankir")
	if home, err := os.UserHomeDir(); err == nil {
		copyLegacyFiles(filepath.Join(home, ".config", "lankir"), dir)
	}
	return dir, nil
}

// copyLegacyFiles copies recent.json and the profiles from legacy to dir,
// each only when dir has none. A failed copy is logged, not returned: the app
// works without them.
func copyLegacyFiles(legacy, dir string) {
	if filepath.Clean(legacy) == filepath.Clean(dir) {
		return
	}
	copyIfMissing(filepath.Join(legacy, RecentFilesName), filepath.Join(dir, RecentFilesName))

	profiles := filepath.Join(dir, ProfilesDirName)
	if existing, _ := filepath.Glob(filepath.Join(profiles, "*.json")); len(existing) > 0 {
		return
	}
	old, _ := filepath.Glob(filepath.Join(legacy, ProfilesDirName, "*.json"))
	for _, src := range old {
		copyIfMissing(src, filepath.Join(profiles, filepath.Base(src)))
	}
}

func copyIfMissing(src, dst string) {
	data, err := os.ReadFile(src)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("failed to read file from Lankir 1.0's folder", "path", src, "error", err)
		}
		return
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		slog.Warn("failed to create config directory", "path", filepath.Dir(dst), "error", err)
		return
	}
	// O_EXCL: another Lankir process may be copying the same file.
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if !errors.Is(err, os.ErrExist) {
			slog.Warn("failed to copy file from Lankir 1.0's folder", "from", src, "to", dst, "error", err)
		}
		return
	}
	_, err = f.Write(data)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(dst)
		slog.Warn("failed to copy file from Lankir 1.0's folder", "from", src, "to", dst, "error", err)
		return
	}
	slog.Info("copied file from Lankir 1.0's folder", "from", src, "to", dst)
}
