package cli

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Matbe34/lankir/internal/pdfops"
	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func mustRun(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	out, err := runCLI(t, stdin, args...)
	if err != nil {
		t.Fatalf("lankir %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return out
}

func pageCount(t *testing.T, path string) int {
	t.Helper()
	n, err := pdfops.PageCount(path)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// widths identifies pages by MediaBox width, which the fixture makes unique per page.
func widths(t *testing.T, path string) []int {
	t.Helper()
	dims, err := api.PageDimsFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	var w []int
	for _, d := range dims {
		w = append(w, int(d.Width))
	}
	return w
}

func TestResolveOutput(t *testing.T) {
	tests := []struct {
		out     string
		inPlace bool
		want    string
		wantErr bool
	}{
		{"o.pdf", false, "o.pdf", false},
		{"", true, "in.pdf", false},
		{"", false, "", true},
		{"o.pdf", true, "", true},
	}
	for _, tt := range tests {
		got, err := resolveOutput("in.pdf", tt.out, tt.inPlace)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("resolveOutput(out=%q, inPlace=%v) = %q, %v", tt.out, tt.inPlace, got, err)
		}
	}
}

func TestRotateCommand(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")
	mustRun(t, "", "pdf", "rotate", in, "--degrees", "90", "--pages", "2", "-o", out)

	dims, err := api.PageDimsFile(context.Background(), out)
	if err != nil {
		t.Fatal(err)
	}
	// A 90 degree rotation swaps the displayed width and height of page 2 only.
	if got := []int{int(dims[0].Width), int(dims[1].Width), int(dims[2].Width)}; !reflect.DeepEqual(got, []int{100, 210, 120}) {
		t.Errorf("widths = %v", got)
	}
	if !reflect.DeepEqual(widths(t, in), []int{100, 110, 120}) {
		t.Error("input was modified")
	}
}

func TestDeleteInPlace(t *testing.T) {
	in := fixture(t, 4)
	mustRun(t, "", "pdf", "delete", in, "--pages", "2,4", "--in-place")
	if got := widths(t, in); !reflect.DeepEqual(got, []int{100, 120}) {
		t.Errorf("widths = %v", got)
	}
}

func TestReorderCommand(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")
	mustRun(t, "", "pdf", "reorder", in, "--order", "3,1,2", "-o", out)
	if got := widths(t, out); !reflect.DeepEqual(got, []int{120, 100, 110}) {
		t.Errorf("widths = %v", got)
	}
}

func TestInsertBlankCommand(t *testing.T) {
	in := fixture(t, 2)
	out := filepath.Join(t.TempDir(), "out.pdf")
	mustRun(t, "", "pdf", "insert-blank", in, "--after", "1", "-o", out)
	if n := pageCount(t, out); n != 3 {
		t.Errorf("pages = %d, want 3", n)
	}
}

func TestExtractCommand(t *testing.T) {
	in := fixture(t, 5)
	out := filepath.Join(t.TempDir(), "out.pdf")
	mustRun(t, "", "pdf", "extract", in, "--pages", "1,3-4", "-o", out)
	if got := widths(t, out); !reflect.DeepEqual(got, []int{100, 120, 130}) {
		t.Errorf("widths = %v", got)
	}
}

func TestSplitCommand(t *testing.T) {
	in := fixture(t, 5)
	dir := t.TempDir()
	out := mustRun(t, "", "pdf", "split", in, "--ranges", "1-2;3,5", "--out-dir", dir)
	p1, p2 := filepath.Join(dir, "doc_part1.pdf"), filepath.Join(dir, "doc_part2.pdf")
	if pageCount(t, p1) != 2 || pageCount(t, p2) != 2 {
		t.Errorf("unexpected page counts in %s", dir)
	}
	if !strings.Contains(out, p1) || !strings.Contains(out, p2) {
		t.Errorf("output does not list created files:\n%s", out)
	}

	dir = t.TempDir()
	mustRun(t, "", "pdf", "split", in, "--every", "2", "--out-dir", dir)
	if pageCount(t, filepath.Join(dir, "doc_part3.pdf")) != 1 {
		t.Error("--every 2 on 5 pages should end with a 1-page part 3")
	}
}

func TestMergeCommand(t *testing.T) {
	a, b := fixture(t, 2), fixture(t, 3)
	out := filepath.Join(t.TempDir(), "merged.pdf")
	mustRun(t, "", "pdf", "merge", out, a, b)
	if n := pageCount(t, out); n != 5 {
		t.Errorf("pages = %d, want 5", n)
	}
}

func TestEncryptDecryptStdinPassword(t *testing.T) {
	in := fixture(t, 2)
	dir := t.TempDir()
	enc, dec := filepath.Join(dir, "enc.pdf"), filepath.Join(dir, "dec.pdf")
	mustRun(t, "s3cret\n", "pdf", "encrypt", in, "--user-password", "-", "-o", enc)
	if _, err := pdfops.PageCount(enc); err == nil {
		t.Fatal("encrypted file opened without a password")
	}
	mustRun(t, "s3cret\n", "pdf", "decrypt", enc, "--password", "-", "-o", dec)
	if n := pageCount(t, dec); n != 2 {
		t.Errorf("pages = %d, want 2", n)
	}
}

func TestMetaSetAndGet(t *testing.T) {
	in := fixture(t, 1)
	out := filepath.Join(t.TempDir(), "out.pdf")
	mustRun(t, "", "pdf", "meta", in, "--set", "title=Hello", "--set", "author=Ann", "-o", out)

	var got map[string]string
	if err := json.Unmarshal([]byte(mustRun(t, "", "pdf", "meta", out, "--json")), &got); err != nil {
		t.Fatal(err)
	}
	if got["title"] != "Hello" || got["author"] != "Ann" {
		t.Errorf("metadata = %v", got)
	}
}

func TestMetaSetUnknownKey(t *testing.T) {
	if _, err := applyMetaSets(pdfops.Metadata{}, []string{"colour=red"}); err == nil {
		t.Error("expected error for unknown key")
	}
	if _, err := applyMetaSets(pdfops.Metadata{}, []string{"title"}); err == nil {
		t.Error("expected error for missing =")
	}
}

func TestOptimizeAndValidate(t *testing.T) {
	in := fixture(t, 2)
	out := filepath.Join(t.TempDir(), "opt.pdf")
	mustRun(t, "", "pdf", "optimize", in, "-o", out)
	mustRun(t, "", "pdf", "validate", out)
}

func TestJSONOutputOfSplit(t *testing.T) {
	in := fixture(t, 4)
	dir := t.TempDir()
	out := mustRun(t, "", "pdf", "split", in, "--every", "2", "--out-dir", dir, "--json")
	var res struct{ Files []string }
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, out)
	}
	if len(res.Files) != 2 {
		t.Errorf("files = %v", res.Files)
	}
}

// The edit commands report like "pdf info": filePath and pageCount.
func TestJSONOutputOfEdit(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")
	var res map[string]any
	if err := json.Unmarshal([]byte(mustRun(t, "", "pdf", "delete", in, "--pages", "1", "-o", out, "--json")), &res); err != nil {
		t.Fatal(err)
	}
	if res["filePath"] != out || res["pageCount"] != float64(2) {
		t.Errorf("result = %v", res)
	}
}

func TestValidateJSONOnInvalidFile(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "bad.pdf")
	if err := os.WriteFile(bad, []byte("not a pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := runCLI(t, "", "pdf", "validate", bad, "--json")
	if err == nil {
		t.Fatal("an invalid file must fail")
	}
	var res map[string]any
	if jerr := json.NewDecoder(strings.NewReader(out)).Decode(&res); jerr != nil {
		t.Fatalf("not JSON: %v\n%s", jerr, out)
	}
	if res["filePath"] != bad || res["valid"] != false || res["error"] == "" || res["error"] == nil {
		t.Errorf("result = %v", res)
	}
}

func TestCommandErrors(t *testing.T) {
	in := fixture(t, 3)
	enc := filepath.Join(t.TempDir(), "enc.pdf")
	mustRun(t, "", "pdf", "encrypt", in, "--user-password", "right", "-o", enc)
	out := filepath.Join(t.TempDir(), "out.pdf")
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"output and in-place", []string{"pdf", "rotate", in, "--degrees", "90", "-o", out, "--in-place"}, "mutually exclusive"},
		{"no output", []string{"pdf", "rotate", in, "--degrees", "90"}, "specify -o/--output or --in-place"},
		{"page out of range", []string{"pdf", "delete", in, "--pages", "7", "-o", out}, "page 7 out of range"},
		{"wrong password", []string{"pdf", "decrypt", enc, "--password", "wrong", "-o", out}, "failed to decrypt PDF"},
		{"huge order", []string{"pdf", "reorder", in, "--order", "1-9223372036854775807", "-o", out}, "--order"},
		{"huge ranges", []string{"pdf", "split", in, "--ranges", "1-99999999", "--out-dir", t.TempDir()}, "--ranges"},
		{"meta output without set", []string{"pdf", "meta", in, "-o", out}, "--set"},
		{"meta in-place without set", []string{"pdf", "meta", in, "--in-place"}, "--set"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := runCLI(t, "", tt.args...)
			if err == nil {
				t.Fatalf("want an error, got:\n%s", got)
			}
			if !strings.Contains(got, tt.want) {
				t.Errorf("output lacks %q:\n%s", tt.want, got)
			}
		})
	}
	if _, err := os.Stat(out); err == nil {
		t.Error("a failed command wrote its output")
	}
}

func TestSplitRefusesExistingParts(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	existing := filepath.Join(dir, "doc_part2.pdf")
	if err := os.WriteFile(existing, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := runCLI(t, "", "pdf", "split", in, "--ranges", "1;2", "--out-dir", dir)
	if err == nil || !strings.Contains(got, existing) {
		t.Fatalf("want an error naming %s, got %v:\n%s", existing, err, got)
	}
	if data, _ := os.ReadFile(existing); string(data) != "keep" {
		t.Error("existing part was replaced")
	}
	if _, err := os.Stat(filepath.Join(dir, "doc_part1.pdf")); err == nil {
		t.Error("split wrote parts before refusing")
	}
}
