package pdfops

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// Page i of a fixture is (100+10i) x (200+10i) points, so every page is identifiable by its width.
func fixtureSizes(n int) [][2]float64 {
	sizes := make([][2]float64, n)
	for i := range sizes {
		sizes[i] = [2]float64{float64(100 + 10*i), float64(200 + 10*i)}
	}
	return sizes
}

func writeTestPDF(t *testing.T, path string, sizes [][2]float64) {
	t.Helper()
	var b bytes.Buffer
	var offsets []int
	obj := func(body string) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
	}
	b.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")

	kids := make([]string, len(sizes))
	for i := range sizes {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(sizes)))
	obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i, s := range sizes {
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>",
			s[0], s[1], 5+2*i))
		content := fmt.Sprintf("BT /F1 12 Tf 10 10 Td (Page %d) Tj ET", i+1)
		obj(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content))
	}

	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)

	if err := os.WriteFile(path, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T, pages int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "doc.pdf")
	writeTestPDF(t, path, fixtureSizes(pages))
	return path
}

type pageAttrs struct {
	Width, Height float64
	Rotate        int
}

func readPages(t *testing.T, path string) []pageAttrs {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	ctx, err := api.ReadAndValidate(context.Background(), f, newConf())
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	out := make([]pageAttrs, ctx.PageCount)
	for i := range out {
		_, _, inh, err := ctx.PageDict(context.Background(), i+1, false)
		if err != nil {
			t.Fatalf("page %d: %v", i+1, err)
		}
		out[i] = pageAttrs{inh.MediaBox.Width(), inh.MediaBox.Height(), (inh.Rotate%360 + 360) % 360}
	}
	return out
}

func widths(t *testing.T, path string) []float64 {
	t.Helper()
	var w []float64
	for _, p := range readPages(t, path) {
		w = append(w, p.Width)
	}
	return w
}

func wantErr(t *testing.T, err error, substr string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error containing %q, got nil", substr)
	}
	if !strings.Contains(err.Error(), substr) {
		t.Fatalf("expected error containing %q, got %q", substr, err)
	}
}

func assertNoFile(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected %s not to exist (stat err: %v)", path, err)
	}
}

// assertOnlyFiles fails if dir holds anything besides names, catching leftover temp files.
func assertOnlyFiles(t *testing.T, dir string, names ...string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range entries {
		got = append(got, e.Name())
	}
	if len(got) == 0 && len(names) == 0 {
		return
	}
	if !reflect.DeepEqual(got, names) {
		t.Fatalf("dir %s holds %v, want %v", dir, got, names)
	}
}

func TestPageCount(t *testing.T) {
	n, err := PageCount(fixture(t, 3))
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("PageCount = %d, want 3", n)
	}
	if _, err := PageCount(filepath.Join(t.TempDir(), "missing.pdf")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestRotate(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")

	if err := Rotate(in, out, []int{2}, 90); err != nil {
		t.Fatal(err)
	}
	got := readPages(t, out)
	for i, want := range []int{0, 90, 0} {
		if got[i].Rotate != want {
			t.Fatalf("page %d rotate = %d, want %d (all: %+v)", i+1, got[i].Rotate, want, got)
		}
	}

	// Empty pages means all; rotation composes with the existing one.
	if err := Rotate(out, out, nil, -90); err != nil {
		t.Fatal(err)
	}
	got = readPages(t, out)
	for i, want := range []int{270, 0, 270} {
		if got[i].Rotate != want {
			t.Fatalf("page %d rotate = %d, want %d (all: %+v)", i+1, got[i].Rotate, want, got)
		}
	}
}

func TestRotateInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, Rotate(in, out, nil, 45), "multiple of 90")
	wantErr(t, Rotate(in, out, []int{0}, 90), "page 0 out of range")
	wantErr(t, Rotate(in, out, []int{4}, 90), "page 4 out of range")
	assertOnlyFiles(t, dir)
}

func TestDeletePages(t *testing.T) {
	in := fixture(t, 4)
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := DeletePages(in, out, []int{3, 1}); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, out), []float64{110, 130}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
}

func TestDeletePagesInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, DeletePages(in, out, []int{1, 2, 3}), "cannot delete all pages")
	wantErr(t, DeletePages(in, out, []int{1, 1, 2}), "duplicate page 1")
	wantErr(t, DeletePages(in, out, nil), "no pages")
	wantErr(t, DeletePages(in, out, []int{5}), "page 5 out of range")
	assertOnlyFiles(t, dir)
}

func TestReorderPages(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := ReorderPages(in, out, []int{3, 1, 2}); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, out), []float64{120, 100, 110}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
}

func TestReorderPagesInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, ReorderPages(in, out, []int{1, 2}), "permutation")
	wantErr(t, ReorderPages(in, out, []int{1, 2, 2}), "duplicate page 2")
	wantErr(t, ReorderPages(in, out, []int{1, 2, 4}), "page 4 out of range")
	wantErr(t, ReorderPages(in, out, nil), "no pages")
	assertOnlyFiles(t, dir)
}

func TestInsertBlankPage(t *testing.T) {
	cases := []struct {
		after int
		want  []float64
	}{
		{0, []float64{100, 100, 110, 120}},
		{2, []float64{100, 110, 110, 120}},
		{3, []float64{100, 110, 120, 120}},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprint(tc.after), func(t *testing.T) {
			in := fixture(t, 3)
			out := filepath.Join(t.TempDir(), "out.pdf")
			if err := InsertBlankPage(in, out, tc.after); err != nil {
				t.Fatal(err)
			}
			if got := widths(t, out); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("widths = %v, want %v", got, tc.want)
			}
			// The blank page also copies its neighbour's height.
			blank := readPages(t, out)[tc.after]
			if blank.Height != blank.Width+100 {
				t.Fatalf("blank page %+v does not match neighbour size", blank)
			}
		})
	}
}

func TestInsertBlankPageNextToRotatedPage(t *testing.T) {
	in := fixture(t, 2)
	if err := Rotate(in, in, []int{1}, 90); err != nil {
		t.Fatal(err)
	}
	if err := InsertBlankPage(in, in, 1); err != nil {
		t.Fatal(err)
	}
	blank := readPages(t, in)[1]
	if blank != (pageAttrs{Width: 200, Height: 100}) {
		t.Fatalf("blank page = %+v, want 200x100 unrotated (page 1 as displayed)", blank)
	}
}

func TestInsertBlankPageInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, InsertBlankPage(in, out, -1), "out of range")
	wantErr(t, InsertBlankPage(in, out, 4), "out of range")
	assertOnlyFiles(t, dir)
}

func TestExtractPages(t *testing.T) {
	in := fixture(t, 4)
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := ExtractPages(in, out, []int{4, 2}); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, out), []float64{130, 110}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
}

func TestExtractPagesInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, ExtractPages(in, out, nil), "no pages")
	wantErr(t, ExtractPages(in, out, []int{0}), "page 0 out of range")
	wantErr(t, ExtractPages(in, out, []int{2, 2}), "duplicate page 2")
	assertOnlyFiles(t, dir)
}

func TestSplit(t *testing.T) {
	in := fixture(t, 5)
	dir := t.TempDir()
	paths, err := Split(in, dir, [][]int{{1, 2}, {3}, {5, 4}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		filepath.Join(dir, "doc_part1.pdf"),
		filepath.Join(dir, "doc_part2.pdf"),
		filepath.Join(dir, "doc_part3.pdf"),
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("paths = %v, want %v", paths, want)
	}
	wantWidths := [][]float64{{100, 110}, {120}, {140, 130}}
	for i, p := range paths {
		if got := widths(t, p); !reflect.DeepEqual(got, wantWidths[i]) {
			t.Fatalf("%s widths = %v, want %v", p, got, wantWidths[i])
		}
	}
	assertOnlyFiles(t, dir, "doc_part1.pdf", "doc_part2.pdf", "doc_part3.pdf")
}

func TestSplitInvalid(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	_, err := Split(in, dir, nil)
	wantErr(t, err, "no ranges")
	_, err = Split(in, dir, [][]int{{1}, {}})
	wantErr(t, err, "range 2: no pages")
	_, err = Split(in, dir, [][]int{{1}, {9}})
	wantErr(t, err, "range 2: page 9 out of range")
	assertOnlyFiles(t, dir)
}

func TestMerge(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.pdf")
	b := filepath.Join(dir, "b.pdf")
	writeTestPDF(t, a, fixtureSizes(2))
	writeTestPDF(t, b, [][2]float64{{300, 400}, {310, 410}, {320, 420}})
	out := filepath.Join(dir, "merged.pdf")
	if err := Merge([]string{a, b}, out); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, out), []float64{100, 110, 300, 310, 320}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}

	// Merging into one of the inputs is the in==out case.
	if err := Merge([]string{a, b}, a); err != nil {
		t.Fatal(err)
	}
	if n, _ := PageCount(a); n != 5 {
		t.Fatalf("in-place merge page count = %d, want 5", n)
	}
}

func TestMergeInvalid(t *testing.T) {
	in := fixture(t, 1)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, Merge(nil, out), "at least 2")
	wantErr(t, Merge([]string{in}, out), "at least 2")
	wantErr(t, Merge([]string{in, filepath.Join(dir, "missing.pdf")}, out), "missing.pdf")
	assertOnlyFiles(t, dir)
}

func TestEncryptDecrypt(t *testing.T) {
	in := fixture(t, 2)
	dir := t.TempDir()
	enc := filepath.Join(dir, "enc.pdf")
	dec := filepath.Join(dir, "dec.pdf")

	if err := Encrypt(in, enc, "user", "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := PageCount(enc); err == nil {
		t.Fatal("expected PageCount on encrypted file without password to fail")
	}
	if err := Decrypt(enc, dec, "wrong"); err == nil {
		t.Fatal("expected Decrypt with wrong password to fail")
	}
	assertNoFile(t, dec)

	if err := Decrypt(enc, dec, "user"); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, dec), []float64{100, 110}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}

	// The owner password also decrypts, in place.
	if err := Decrypt(enc, enc, "owner"); err != nil {
		t.Fatal(err)
	}
	if n, err := PageCount(enc); err != nil || n != 2 {
		t.Fatalf("PageCount after in-place decrypt = %d, %v", n, err)
	}
}

func TestEncryptInvalid(t *testing.T) {
	in := fixture(t, 1)
	dir := t.TempDir()
	out := filepath.Join(dir, "out.pdf")
	wantErr(t, Encrypt(in, out, "", ""), "password")
	assertOnlyFiles(t, dir)
}

func TestMetadataRoundtrip(t *testing.T) {
	in := fixture(t, 1)
	out := filepath.Join(t.TempDir(), "out.pdf")
	m := Metadata{
		Title:    "Título con acentos",
		Author:   "Ferran",
		Subject:  "Testing",
		Keywords: "a, b, c",
		Creator:  "Lankir",
		Producer: "Lankir Producer",
	}
	if err := SetMetadata(in, out, m); err != nil {
		t.Fatal(err)
	}
	got, err := GetMetadata(out)
	if err != nil {
		t.Fatal(err)
	}
	if got != m {
		t.Fatalf("metadata = %+v, want %+v", got, m)
	}

	// Empty fields clear entries.
	if err := SetMetadata(out, out, Metadata{Title: "Only title"}); err != nil {
		t.Fatal(err)
	}
	got, err = GetMetadata(out)
	if err != nil {
		t.Fatal(err)
	}
	if got != (Metadata{Title: "Only title"}) {
		t.Fatalf("metadata = %+v, want only title", got)
	}
}

// pdfcpu rebuilds the document for page removal and reordering; the info dictionary must survive.
func TestPageOpsKeepMetadata(t *testing.T) {
	m := Metadata{Title: "Kept", Author: "Ferran", Keywords: "x"}
	ops := map[string]func(in, out string) error{
		"delete":  func(in, out string) error { return DeletePages(in, out, []int{1}) },
		"reorder": func(in, out string) error { return ReorderPages(in, out, []int{3, 2, 1}) },
		"extract": func(in, out string) error { return ExtractPages(in, out, []int{2}) },
	}
	for name, op := range ops {
		t.Run(name, func(t *testing.T) {
			in := fixture(t, 3)
			if err := SetMetadata(in, in, m); err != nil {
				t.Fatal(err)
			}
			if err := op(in, in); err != nil {
				t.Fatal(err)
			}
			got, err := GetMetadata(in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Title != m.Title || got.Author != m.Author || got.Keywords != m.Keywords {
				t.Fatalf("metadata = %+v, want %+v", got, m)
			}
		})
	}
}

func TestOptimizeAndValidate(t *testing.T) {
	in := fixture(t, 3)
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := Optimize(in, out); err != nil {
		t.Fatal(err)
	}
	if err := Validate(out); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, out), []float64{100, 110, 120}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}

	garbage := filepath.Join(t.TempDir(), "garbage.pdf")
	if err := os.WriteFile(garbage, []byte("not a pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Validate(garbage); err == nil {
		t.Fatal("expected Validate to fail on garbage")
	}
}

func TestInPlace(t *testing.T) {
	in := fixture(t, 3)
	if err := ReorderPages(in, in, []int{2, 3, 1}); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, in), []float64{110, 120, 100}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
	if err := DeletePages(in, in, []int{1}); err != nil {
		t.Fatal(err)
	}
	if err := InsertBlankPage(in, in, 0); err != nil {
		t.Fatal(err)
	}
	if got, want := widths(t, in), []float64{120, 120, 100}; !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
	assertOnlyFiles(t, filepath.Dir(in), "doc.pdf")
}

func TestFailedOpLeavesNoOutput(t *testing.T) {
	dir := t.TempDir()
	garbage := filepath.Join(dir, "garbage.pdf")
	if err := os.WriteFile(garbage, []byte("%PDF-1.7\nbroken"), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "out.pdf")
	if err := Rotate(garbage, out, nil, 90); err == nil {
		t.Fatal("expected Rotate on garbage to fail")
	}
	if err := Optimize(garbage, out); err == nil {
		t.Fatal("expected Optimize on garbage to fail")
	}
	assertOnlyFiles(t, dir, "garbage.pdf")

	// A failed in-place op leaves the original untouched.
	in := fixture(t, 2)
	before, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	if err := DeletePages(in, in, []int{1, 2}); err == nil {
		t.Fatal("expected error")
	}
	after, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed in-place op modified the input")
	}
	assertOnlyFiles(t, filepath.Dir(in), "doc.pdf")
}

func TestOutputDirMissing(t *testing.T) {
	in := fixture(t, 1)
	out := filepath.Join(t.TempDir(), "nope", "out.pdf")
	if err := Rotate(in, out, nil, 90); err == nil {
		t.Fatal("expected error writing into missing directory")
	}
}

// samplesDir returns the repo's samples/ directory (not tracked in git), or skips.
func samplesDir(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("LANKIR_SAMPLES")
	if dir == "" {
		dir = filepath.Join("..", "..", "samples")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Skipf("no samples directory at %s (set LANKIR_SAMPLES)", dir)
	}
	return dir
}

func TestSamples(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(samplesDir(t), "*.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Skip("no sample PDFs")
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			if err := Validate(f); err != nil {
				t.Fatalf("Validate: %v", err)
			}
			n, err := PageCount(f)
			if err != nil {
				t.Fatalf("PageCount: %v", err)
			}
			if n < 1 {
				t.Fatalf("PageCount = %d", n)
			}
			if _, err := GetMetadata(f); err != nil {
				t.Fatalf("GetMetadata: %v", err)
			}
			out := filepath.Join(t.TempDir(), "rotated.pdf")
			if err := Rotate(f, out, []int{1}, 90); err != nil {
				t.Fatalf("Rotate: %v", err)
			}
			pages := readPages(t, out)
			if len(pages) != n {
				t.Fatalf("rotated page count = %d, want %d", len(pages), n)
			}
			orig := readPages(t, f)
			if want := (orig[0].Rotate + 90) % 360; pages[0].Rotate != want {
				t.Fatalf("page 1 rotate = %d, want %d", pages[0].Rotate, want)
			}
		})
	}
}

func TestSplitRefusesExistingParts(t *testing.T) {
	in := fixture(t, 3)
	dir := t.TempDir()
	existing := filepath.Join(dir, "doc_part2.pdf")
	if err := os.WriteFile(existing, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Split(in, dir, [][]int{{1}, {2}})
	wantErr(t, err, existing)
	if data, _ := os.ReadFile(existing); string(data) != "keep" {
		t.Error("existing part was replaced")
	}
	assertOnlyFiles(t, dir, "doc_part2.pdf")
}

func TestInPlaceThroughSymlink(t *testing.T) {
	target := fixture(t, 3)
	link := filepath.Join(t.TempDir(), "link.pdf")
	if err := os.Symlink(target, link); err != nil {
		t.Skip("no symlinks:", err)
	}
	if err := DeletePages(link, link, []int{1}); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Lstat(link); err != nil || fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("the symlink was replaced by a regular file: %v", err)
	}
	if got, want := widths(t, target), []float64{110, 120}; !reflect.DeepEqual(got, want) {
		t.Fatalf("target widths = %v, want %v", got, want)
	}
}
