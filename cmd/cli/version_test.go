package cli

import (
	"bytes"
	"testing"

	"github.com/Matbe34/lankir/internal/version"
)

// Release builds set version.Version with -ldflags -X; --version must report it.
func TestVersionFlagReportsInjectedVersion(t *testing.T) {
	old := version.Version
	version.Version = "1.2.3-test"
	var out bytes.Buffer
	rootCmd.SetOut(&out)
	t.Cleanup(func() {
		version.Version = old
		rootCmd.Version = ""
		rootCmd.SetOut(nil)
		rootCmd.SetArgs(nil)
		resetFlags(rootCmd)
	})

	ExecuteWithArgs([]string{"--version"}, func([]string) { t.Fatal("--version started the GUI") })

	if got, want := out.String(), "lankir version 1.2.3-test\n"; got != want {
		t.Errorf("--version printed %q, want %q", got, want)
	}
}
