package cli

import (
	"strings"
	"testing"
)

// The --source help must name the values certificates really carry.
func TestCertListSourceHelpNamesRealSources(t *testing.T) {
	usage := certListCmd.Flags().Lookup("source").Usage
	for _, want := range []string{`"User File"`, `"User Store"`, "pkcs11", `"NSS Database"`} {
		if !strings.Contains(usage, want) {
			t.Errorf("--source help %q does not name %s", usage, want)
		}
	}
	if strings.Contains(usage, "system") {
		t.Errorf("--source help %q names system, which no certificate carries", usage)
	}
}
