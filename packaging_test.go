package main

import (
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The desktop file names an icon the packages install into the hicolor theme,
// at the size each folder says, so menus, panels and software centres find it.
func TestPackagedIconMatchesTheDesktopFile(t *testing.T) {
	desktop, err := os.ReadFile("packaging/com.lankir.Lankir.desktop")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^Icon=(.+)$`).FindSubmatch(desktop)
	if m == nil || string(m[1]) != "com.lankir.Lankir" {
		t.Fatalf("desktop file Icon=%q, want com.lankir.Lankir", m)
	}
	for _, size := range []int{16, 24, 32, 48, 64, 128, 256, 512} {
		path := filepath.Join("packaging/icons/hicolor", fmt.Sprintf("%dx%d", size, size), "apps", "com.lankir.Lankir.png")
		f, err := os.Open(path)
		if err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		cfg, err := png.DecodeConfig(f)
		f.Close()
		if err != nil || cfg.Width != size || cfg.Height != size {
			t.Errorf("%s: %dx%d (%v), want %dx%d", path, cfg.Width, cfg.Height, err, size, size)
		}
	}
	nfpm, err := os.ReadFile("nfpm.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, size := range []int{16, 24, 32, 48, 64, 128, 256, 512} {
		file := fmt.Sprintf("%dx%d/apps/com.lankir.Lankir.png", size, size)
		entry := fmt.Sprintf("  - src: ./packaging/icons/hicolor/%s\n    dst: /usr/share/icons/hicolor/%s\n", file, file)
		if !strings.Contains(string(nfpm), entry) {
			t.Errorf("nfpm.yaml doesn't install the %dpx icon into /usr/share/icons/hicolor", size)
		}
	}
}

// GNOME Shell doesn't look for icons in a folder that has an icon cache, so
// one in /usr/share/pixmaps hides every icon there (1.0's postinstall built it).
func TestPostinstallBuildsNoIconCacheInPixmaps(t *testing.T) {
	script, err := os.ReadFile("packaging/postinstall.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(script), "\n") {
		if strings.Contains(line, "gtk-update-icon-cache") && strings.Contains(line, "pixmaps") {
			t.Errorf("postinstall builds an icon cache in pixmaps: %s", strings.TrimSpace(line))
		}
	}
	if !strings.Contains(string(script), "rm -f /usr/share/pixmaps/icon-theme.cache") {
		t.Error("postinstall doesn't remove the pixmaps icon cache older packages left")
	}
}
