package cli

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/Matbe34/lankir/internal/config"
)

// isolateConfig gives the test its own home and config.json.
func isolateConfig(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	return home
}

func savedConfig(t *testing.T) *config.Config {
	t.Helper()
	service, err := config.NewService()
	if err != nil {
		t.Fatal(err)
	}
	return service.Get()
}

// jsonKeys returns every config.json key with its field kind.
func jsonKeys() map[string]reflect.Kind {
	keys := map[string]reflect.Kind{}
	typ := reflect.TypeOf(config.Config{})
	for i := 0; i < typ.NumField(); i++ {
		name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ",")
		keys[name] = typ.Field(i).Type.Kind()
	}
	return keys
}

// The app writes these when you sign; config set leaves them alone.
var keysSavedWhenSigning = []string{"lastCertificateFingerprint", "lastSignatureProfileId"}

// Text keys that take only some values, with one they take.
var limitedValues = map[string]string{"theme": "light", "accentColor": "#12ab9F"}

// Every scalar config.json key can be set and read back, with its type.
func TestConfigSetGetEveryKey(t *testing.T) {
	isolateConfig(t)
	defaults := reflect.ValueOf(savedConfig(t)).Elem()

	for key, kind := range jsonKeys() {
		if kind == reflect.Slice || slices.Contains(keysSavedWhenSigning, key) {
			continue
		}
		t.Run(key, func(t *testing.T) {
			var value string
			var want any
			switch kind {
			case reflect.Bool:
				b := !defaults.FieldByIndex(fieldIndex(key)).Bool()
				value, want = fmt.Sprint(b), b
			case reflect.Int:
				value, want = "42", float64(42)
			case reflect.String:
				value = "https://example.test/" + key
				if v, ok := limitedValues[key]; ok {
					value = v
				}
				want = value
			default:
				t.Fatalf("no test value for kind %s", kind)
			}

			mustRun(t, "", "config", "set", key, value)
			if out := mustRun(t, "", "config", "get", strings.ToLower(key)); out != key+": "+value+"\n" {
				t.Errorf("config get %s printed %q, want %q", key, out, key+": "+value+"\n")
			}
			var got map[string]any
			out := mustRun(t, "", "config", "get", key, "--json")
			if err := json.Unmarshal([]byte(out), &got); err != nil || got[key] != want {
				t.Errorf("config get %s --json printed %q, want %v (err %v)", key, out, want, err)
			}
			saved := reflect.ValueOf(savedConfig(t)).Elem().FieldByIndex(fieldIndex(key)).Interface()
			if fmt.Sprint(saved) != value {
				t.Errorf("config.json has %s = %v, want %s", key, saved, value)
			}
		})
	}
}

func fieldIndex(key string) []int {
	typ := reflect.TypeOf(config.Config{})
	for i := 0; i < typ.NumField(); i++ {
		if name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ","); name == key {
			return []int{i}
		}
	}
	panic("no config key " + key)
}

func TestConfigGetListsEveryKey(t *testing.T) {
	isolateConfig(t)
	out := mustRun(t, "", "config", "get")
	for key := range jsonKeys() {
		if !strings.Contains(out, "\n"+key+":") && !strings.HasPrefix(out, key+":") {
			t.Errorf("config get does not list %s:\n%s", key, out)
		}
	}
}

func TestConfigSetRejects(t *testing.T) {
	isolateConfig(t)
	for _, args := range [][]string{
		{"nope", "1"},
		{"debugMode", "maybe"},
		{"defaultZoom", "big"},
		{"certificateStores", "/tmp"},
		{"lastCertificateFingerprint", "abc"},
	} {
		if out, err := runCLI(t, "", append([]string{"config", "set"}, args...)...); err == nil {
			t.Errorf("config set %v succeeded: %s", args, out)
		}
	}
}

// config set stores only what the Settings dialog would.
func TestConfigSetKeepsTheSettingsDialogLimits(t *testing.T) {
	isolateConfig(t)
	for _, tt := range []struct{ key, value, message string }{
		{"theme", "blue", "theme must be light, dark or auto"},
		{"theme", "", "theme must be light, dark or auto"},
		{"accentColor", "red", "accentColor must be a colour as #rrggbb"},
		{"accentColor", "#12345", "accentColor must be a colour as #rrggbb"},
		{"defaultZoom", "9", "defaultZoom must be from 10 to 400"},
		{"defaultZoom", "401", "defaultZoom must be from 10 to 400"},
		{"recentFilesLength", "0", "recentFilesLength must be from 1 to 50"},
		{"recentFilesLength", "51", "recentFilesLength must be from 1 to 50"},
	} {
		out, err := runCLI(t, "", "config", "set", "--", tt.key, tt.value)
		if err == nil || !strings.Contains(out, tt.message) {
			t.Errorf("config set %s %q: %v, %q; want an error saying %q", tt.key, tt.value, err, out, tt.message)
		}
	}
	if cfg := savedConfig(t); cfg.Theme != "dark" || cfg.DefaultZoom != 100 || cfg.RecentFilesLength != 5 || cfg.AccentColor != "#007acc" {
		t.Errorf("after rejected values: %+v, want the defaults", cfg)
	}
	if _, err := runCLI(t, "", "config", "set", "theme", "Dark"); err == nil {
		t.Error("config set theme Dark succeeded; the dialog stores dark")
	}
	for _, args := range [][]string{
		{"theme", "auto"}, {"theme", "dark"}, {"defaultZoom", "10"}, {"defaultZoom", "400"},
		{"recentFilesLength", "1"}, {"recentFilesLength", "50"},
	} {
		mustRun(t, "", append([]string{"config", "set"}, args...)...)
	}
	if cfg := savedConfig(t); cfg.Theme != "dark" || cfg.DefaultZoom != 400 || cfg.RecentFilesLength != 50 {
		t.Errorf("theme %q, zoom %d, recent %d; want dark, 400, 50", cfg.Theme, cfg.DefaultZoom, cfg.RecentFilesLength)
	}
}

func TestConfigAddRemoveLists(t *testing.T) {
	home := isolateConfig(t)
	store := filepath.Join(home, "certs")
	lib := "/usr/lib/lankir-test-pkcs11.so"

	mustRun(t, "", "config", "add", "certificateStores", store)
	mustRun(t, "", "config", "add", "tokenlibraries", lib)
	cfg := savedConfig(t)
	if !slices.Contains(cfg.CertificateStores, store) || !slices.Contains(cfg.TokenLibraries, lib) {
		t.Fatalf("after add: stores %v, libraries %v", cfg.CertificateStores, cfg.TokenLibraries)
	}
	if out := mustRun(t, "", "config", "get", "certificateStores"); !strings.Contains(out, "\n  "+store+"\n") {
		t.Errorf("config get certificateStores printed %q", out)
	}

	mustRun(t, "", "config", "remove", "certificateStores", store)
	mustRun(t, "", "config", "remove", "tokenLibraries", lib)
	cfg = savedConfig(t)
	if slices.Contains(cfg.CertificateStores, store) || slices.Contains(cfg.TokenLibraries, lib) {
		t.Errorf("after remove: stores %v, libraries %v", cfg.CertificateStores, cfg.TokenLibraries)
	}

	for _, args := range [][]string{
		{"add", "theme", "dark"},
		{"add", "tokenLibraries", "/usr/lib/not-a-library.txt"},
		{"remove", "certificateStores", filepath.Join(home, "never-added")},
	} {
		if out, err := runCLI(t, "", append([]string{"config"}, args...)...); err == nil {
			t.Errorf("config %v succeeded: %s", args, out)
		}
	}
}
