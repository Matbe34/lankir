package cli

import (
	"encoding/json"
	"strings"
	"testing"
)

// Scripts parse --json output, so a PDF without signatures prints an empty
// JSON list; the text output keeps its sentence.
func TestSignVerifyUnsignedPDF(t *testing.T) {
	in := fixture(t, 1)

	out := mustRun(t, "", "sign", "verify", "--json", in)
	var sigs []any
	if err := json.Unmarshal([]byte(out), &sigs); err != nil || sigs == nil || len(sigs) != 0 {
		t.Errorf("sign verify --json printed %q, want an empty JSON list (err %v)", out, err)
	}

	if out := mustRun(t, "", "sign", "verify", in); strings.TrimSpace(out) != "No signatures found in PDF" {
		t.Errorf("sign verify printed %q", out)
	}
}
