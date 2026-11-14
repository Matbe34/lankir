package pdf

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func writeFile(t *testing.T, path string, data []byte, perm os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, data, perm); err != nil {
		t.Fatal(err)
	}
}

func TestOpenPDFByPath_RegistersDocument(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	CreateTestPDF(t, path, 1)

	s := NewPDFService()
	doc, err := s.OpenPDFByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if doc.ID == "" || doc.Path != path || doc.FileName != "a.pdf" {
		t.Fatalf("unexpected document %+v", doc)
	}
	info, _ := os.Stat(path)
	if doc.Size != info.Size() {
		t.Errorf("size = %d, want %d", doc.Size, info.Size())
	}

	again, err := s.OpenPDFByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID == doc.ID {
		t.Error("each open must get its own id")
	}
}

func TestOpenPDFByPath_MakesPathAbsolute(t *testing.T) {
	dir := t.TempDir()
	CreateTestPDF(t, filepath.Join(dir, "rel.pdf"), 1)
	t.Chdir(dir)

	doc, err := NewPDFService().OpenPDFByPath("rel.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Path != filepath.Join(dir, "rel.pdf") {
		t.Errorf("path = %q, want absolute", doc.Path)
	}
}

func TestOpenPDFByPath_Errors(t *testing.T) {
	dir := t.TempDir()
	s := NewPDFService()
	if _, err := s.OpenPDFByPath(filepath.Join(dir, "missing.pdf")); err == nil {
		t.Error("missing file: expected error")
	}
	if _, err := s.OpenPDFByPath(dir); err == nil {
		t.Error("directory: expected error")
	}
}

func TestClosePDF_RemovesDocument(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	CreateTestPDF(t, path, 1)

	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)
	if err := s.ClosePDF(doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ClosePDF(doc.ID); err == nil {
		t.Error("closing an unknown id should fail")
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+doc.ID, nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("closed doc served with %d", rec.Code)
	}
}

func TestServeHTTP_StreamsRegisteredFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	CreateTestPDF(t, path, 1)
	want, _ := os.ReadFile(path)

	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+doc.ID, nil))
	res := rec.Result()
	body, _ := io.ReadAll(res.Body)

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if !bytes.Equal(body, want) {
		t.Error("body differs from file")
	}
}

func TestServeHTTP_UnknownIDsAndPaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	CreateTestPDF(t, path, 1)
	s := NewPDFService()
	if _, err := s.OpenPDFByPath(path); err != nil {
		t.Fatal(err)
	}

	for _, target := range []string{"/nope", "/" + path, "/", "/../a.pdf"} {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.URL.Path = target
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%q: status = %d, want 404", target, rec.Code)
		}
	}
}

func TestSavePDF_ReplacesFileAtomicallyKeepingPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-old"), 0o640)

	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)
	saved, err := s.SavePDF(doc.ID, []byte("%PDF-new content"), false)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "%PDF-new content" {
		t.Errorf("file = %q", got)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o640 {
		t.Errorf("mode = %v, want 0640", info.Mode().Perm())
	}
	if saved.Size != int64(len("%PDF-new content")) || saved.ID != doc.ID {
		t.Errorf("unexpected saved document %+v", saved)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("temp files left behind: %v", entries)
	}
}

func TestSavePDF_FailureLeavesOriginalIntact(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)

	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	if _, err := s.SavePDF(doc.ID, []byte("%PDF-new"), false); err == nil {
		t.Fatal("expected error writing into a read-only directory")
	}
	got, _ := os.ReadFile(path)
	if string(got) != "%PDF-original" {
		t.Errorf("original changed: %q", got)
	}
}

func TestSavePDF_RejectsEmptyAndUnknown(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	if _, err := s.SavePDF(doc.ID, nil, false); err == nil {
		t.Error("empty data: expected error")
	}
	if _, err := s.SavePDF("unknown", []byte("%PDF-x"), false); err == nil {
		t.Error("unknown id: expected error")
	}
	got, _ := os.ReadFile(path)
	if string(got) != "%PDF-original" {
		t.Errorf("original changed: %q", got)
	}
}

func TestSaveAs_WritesNewPathAndUpdatesRegistry(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	newPath := filepath.Join(dir, "b.pdf")

	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)
	s.chooseSaveAsPath(doc.ID, newPath)
	saved, err := s.SavePDFAs(doc.ID, newPath, []byte("%PDF-copy"))
	if err != nil {
		t.Fatal(err)
	}
	if saved.Path != newPath || saved.FileName != "b.pdf" || saved.ID != doc.ID {
		t.Errorf("unexpected document %+v", saved)
	}
	if got, _ := os.ReadFile(newPath); string(got) != "%PDF-copy" {
		t.Errorf("new file = %q", got)
	}
	if got, _ := os.ReadFile(path); string(got) != "%PDF-original" {
		t.Errorf("old file changed: %q", got)
	}

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+doc.ID, nil))
	if rec.Body.String() != "%PDF-copy" {
		t.Errorf("registry still serves old path: %q", rec.Body.String())
	}
}

func TestSavePDFAs_RejectsRelativePath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)
	if _, err := s.SavePDFAs(doc.ID, "b.pdf", []byte("%PDF-x")); err == nil {
		t.Error("relative path: expected error")
	}
}

func TestSavePDFAs_OnlyWritesThePathChosenInTheDialog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	other := filepath.Join(dir, "other.pdf")
	if _, err := s.SavePDFAs(doc.ID, other, []byte("%PDF-x")); err == nil {
		t.Error("no path chosen: expected error")
	}
	s.chooseSaveAsPath(doc.ID, filepath.Join(dir, "chosen.pdf"))
	if _, err := s.SavePDFAs(doc.ID, other, []byte("%PDF-x")); err == nil {
		t.Error("path differs from the chosen one: expected error")
	}
	if _, err := os.Stat(other); !os.IsNotExist(err) {
		t.Errorf("unchosen path was written: %v", err)
	}
}

func TestSavePDFAs_RefusesAPathOpenUnderAnotherID(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.pdf")
	b := filepath.Join(dir, "b.pdf")
	writeFile(t, a, []byte("%PDF-A"), 0o644)
	writeFile(t, b, []byte("%PDF-B"), 0o644)
	s := NewPDFService()
	docA, _ := s.OpenPDFByPath(a)
	docB, _ := s.OpenPDFByPath(b)

	s.chooseSaveAsPath(docB.ID, a)
	_, err := s.SavePDFAs(docB.ID, a, []byte("%PDF-B-as-A"))
	var conflict *ConflictError
	if !errors.As(err, &conflict) || conflict.Reason != ConflictOpen || conflict.Path != a {
		t.Fatalf("err = %v, want an open-elsewhere conflict for %s", err, a)
	}
	if got, _ := os.ReadFile(a); string(got) != "%PDF-A" {
		t.Errorf("a.pdf overwritten: %q", got)
	}

	if err := s.ClosePDF(docA.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePDFAs(docB.ID, a, []byte("%PDF-B-as-A")); err != nil {
		t.Errorf("after closing the other tab: %v", err)
	}
}

func TestSavePDF_RefusesAFileChangedOnDiskUnlessOverwriting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	writeFile(t, path, []byte("%PDF-changed elsewhere"), 0o644)
	_, err := s.SavePDF(doc.ID, []byte("%PDF-mine"), false)
	var conflict *ConflictError
	if !errors.As(err, &conflict) || conflict.Reason != ConflictChanged {
		t.Fatalf("err = %v, want a changed-on-disk conflict", err)
	}
	if got, _ := os.ReadFile(path); string(got) != "%PDF-changed elsewhere" {
		t.Errorf("file overwritten: %q", got)
	}

	if _, err := s.SavePDF(doc.ID, []byte("%PDF-mine"), true); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	// The registry now records our write, so the next save goes through.
	if _, err := s.SavePDF(doc.ID, []byte("%PDF-mine again"), false); err != nil {
		t.Errorf("save after own write: %v", err)
	}
}

func TestSavePDF_DetectsAChangeThatKeepsTheSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-AAAA"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	writeFile(t, path, []byte("%PDF-BBBB"), 0o644)
	later := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
	var conflict *ConflictError
	if _, err := s.SavePDF(doc.ID, []byte("%PDF-mine"), false); !errors.As(err, &conflict) {
		t.Errorf("err = %v, want a conflict", err)
	}
}

func TestSavePDF_WritesThroughASymlink(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real.pdf")
	link := filepath.Join(dir, "link.pdf")
	writeFile(t, real, []byte("%PDF-real"), 0o640)
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(link)
	if _, err := s.SavePDF(doc.ID, []byte("%PDF-edited"), false); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Lstat(link); info.Mode()&os.ModeSymlink == 0 {
		t.Error("the symlink was replaced by a regular file")
	}
	if got, _ := os.ReadFile(real); string(got) != "%PDF-edited" {
		t.Errorf("target = %q", got)
	}
	if info, _ := os.Stat(real); info.Mode().Perm() != 0o640 {
		t.Errorf("target mode = %v, want 0640", info.Mode().Perm())
	}
}

func TestSavePDF_RefusesAReadOnlyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ro.pdf")
	writeFile(t, path, []byte("%PDF-orig"), 0o444)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	if _, err := s.SavePDF(doc.ID, []byte("%PDF-new"), false); err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("err = %v, want a read-only error", err)
	}
	if got, _ := os.ReadFile(path); string(got) != "%PDF-orig" {
		t.Errorf("read-only file replaced: %q", got)
	}
}

func TestSavePDFAs_NewFileFollowsTheUmask(t *testing.T) {
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-A"), 0o600)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	newPath := filepath.Join(dir, "new.pdf")
	s.chooseSaveAsPath(doc.ID, newPath)
	if _, err := s.SavePDFAs(doc.ID, newPath, []byte("%PDF-x")); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(newPath); info.Mode().Perm() != 0o600 {
		t.Errorf("new file mode = %v, want 0600 (0666 &^ umask 077)", info.Mode().Perm())
	}
}

func TestServeHTTP_PutSavesTheBody(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pdf")
	writeFile(t, path, []byte("%PDF-original"), 0o644)
	s := NewPDFService()
	doc, _ := s.OpenPDFByPath(path)

	put := func(target, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, target, strings.NewReader(body)))
		return rec
	}

	rec := put("/"+doc.ID, "%PDF-uploaded")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"fileName":"a.pdf"`) {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(path); string(got) != "%PDF-uploaded" {
		t.Errorf("file = %q", got)
	}

	writeFile(t, path, []byte("%PDF-changed elsewhere"), 0o644)
	rec = put("/"+doc.ID, "%PDF-mine")
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"conflict":"changed"`) {
		t.Errorf("changed on disk: %d %s", rec.Code, rec.Body)
	}
	if rec = put("/"+doc.ID+"?overwrite=1", "%PDF-mine"); rec.Code != http.StatusOK {
		t.Errorf("overwrite: %d %s", rec.Code, rec.Body)
	}

	newPath := filepath.Join(dir, "b.pdf")
	if rec = put("/"+doc.ID+"?saveAs="+newPath, "%PDF-copy"); rec.Code == http.StatusOK {
		t.Error("save as to an unchosen path succeeded")
	}
	s.chooseSaveAsPath(doc.ID, newPath)
	if rec = put("/"+doc.ID+"?saveAs="+newPath, "%PDF-copy"); rec.Code != http.StatusOK {
		t.Errorf("save as: %d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(newPath); string(got) != "%PDF-copy" {
		t.Errorf("new file = %q", got)
	}
}
