package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// xdgHome points HOME and XDG_CONFIG_HOME at separate temp dirs and returns
// 1.0's profile and recent-files dir (~/.config/lankir) and Lankir's dir
// under XDG_CONFIG_HOME.
func xdgHome(t *testing.T) (legacy, xdg string) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "xdg"))
	return filepath.Join(root, "home", ".config", "lankir"), filepath.Join(root, "xdg", "lankir")
}

func TestDirFollowsXDGConfigHomeAndCopiesProfilesAndRecentFiles(t *testing.T) {
	legacy, xdg := xdgHome(t)
	writeFile(t, filepath.Join(legacy, "recent.json"), `[{"filePath":"/a.pdf"}]`)
	writeFile(t, filepath.Join(legacy, "signature_profiles", "p1.json"), `{"name":"one"}`)
	writeFile(t, filepath.Join(legacy, "signature_profiles", "p2.json"), `{"name":"two"}`)

	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if dir != xdg {
		t.Fatalf("Dir() = %s, want %s", dir, xdg)
	}
	for _, rel := range []string{"recent.json", "signature_profiles/p1.json", "signature_profiles/p2.json"} {
		if got, want := readFile(t, filepath.Join(xdg, rel)), readFile(t, filepath.Join(legacy, rel)); got != want {
			t.Errorf("%s copied as %q, want %q", rel, got, want)
		}
	}
}

// The copy happens once: what is already in the XDG dir is never replaced or
// added to.
func TestDirKeepsWhatTheXDGDirHas(t *testing.T) {
	legacy, xdg := xdgHome(t)
	writeFile(t, filepath.Join(legacy, "recent.json"), "old")
	writeFile(t, filepath.Join(legacy, "signature_profiles", "old.json"), "old")
	writeFile(t, filepath.Join(xdg, "recent.json"), "new")
	writeFile(t, filepath.Join(xdg, "signature_profiles", "new.json"), "new")

	if _, err := Dir(); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(xdg, "recent.json")); got != "new" {
		t.Errorf("recent.json = %q, want it kept", got)
	}
	if _, err := os.Stat(filepath.Join(xdg, "signature_profiles", "old.json")); !os.IsNotExist(err) {
		t.Errorf("old.json was copied next to the XDG dir's own profiles (stat err %v)", err)
	}
}

func TestDirWithoutXDGConfigHomeIsDotConfig(t *testing.T) {
	legacy, _ := xdgHome(t)
	t.Setenv("XDG_CONFIG_HOME", "")
	writeFile(t, filepath.Join(legacy, "recent.json"), "same")

	dir, err := Dir()
	if err != nil || dir != legacy {
		t.Fatalf("Dir() = %s, %v; want %s", dir, err, legacy)
	}
	if got := readFile(t, filepath.Join(legacy, "recent.json")); got != "same" {
		t.Errorf("recent.json = %q", got)
	}
}

func TestNewServiceUsesDir(t *testing.T) {
	_, xdg := xdgHome(t)
	service, err := NewService()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(xdg, "config.json"); service.configPath != want {
		t.Errorf("configPath = %s, want %s", service.configPath, want)
	}
}
