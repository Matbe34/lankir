package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

func TestRenderAndThumbnailWritePNG(t *testing.T) {
	in := fixture(t, 2)
	dir := t.TempDir()
	cases := map[string][]string{
		"render":    {"pdf", "render", in, "-o", filepath.Join(dir, "render.png")},
		"thumbnail": {"pdf", "thumbnail", in, "-o", filepath.Join(dir, "thumbnail.png")},
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := runCLI(t, "", args...); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(args[len(args)-1])
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.HasPrefix(data, pngSignature) {
				t.Fatalf("output is not a PNG, starts with %q", data[:min(len(data), 16)])
			}
		})
	}
}
