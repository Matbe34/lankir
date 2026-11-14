package signature

import (
	"os"
	"testing"
)

// Tests construct services with default paths under the home directory;
// point HOME at a throwaway dir so they never touch the user's real config.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "lankir-test-home-")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", home)
	os.Setenv("XDG_CONFIG_HOME", home+"/.config")
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}
