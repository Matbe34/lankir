package pdf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/Matbe34/lankir/internal/pdfops"
)

// writePagesPDF writes a valid PDF whose page i is (100+10i) points wide.
func writePagesPDF(t *testing.T, path string, pages int) {
	t.Helper()
	var b bytes.Buffer
	var offsets []int
	obj := func(body string) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
	}
	b.WriteString("%PDF-1.7\n")
	kids := make([]string, pages)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 3+i)
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pages))
	for i := range pages {
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d 300] >>", 100+10*i))
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	writeFile(t, path, b.Bytes(), 0o644)
}

// served returns what pdf.js would load for the document right now.
func served(t *testing.T, s *PDFService, id string) []byte {
	t.Helper()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+id, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: %d", id, rec.Code)
	}
	return rec.Body.Bytes()
}

type servedPage struct{ width, rotate int }

func servedPages(t *testing.T, s *PDFService, id string) []servedPage {
	t.Helper()
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	ctx, err := api.ReadAndValidate(context.Background(), bytes.NewReader(served(t, s, id)), conf)
	if err != nil {
		t.Fatal(err)
	}
	pages := make([]servedPage, ctx.PageCount)
	for i := range pages {
		_, _, inh, err := ctx.PageDict(context.Background(), i+1, false)
		if err != nil {
			t.Fatal(err)
		}
		pages[i] = servedPage{int(inh.MediaBox.Width()), (inh.Rotate%360 + 360) % 360}
	}
	return pages
}

func openPages(t *testing.T, s *PDFService, pages int) (*Document, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "doc.pdf")
	writePagesPDF(t, path, pages)
	doc, err := s.OpenPDFByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	return doc, path
}

func workFiles(t *testing.T, s *PDFService) []string {
	t.Helper()
	if s.workDir == "" {
		return nil
	}
	entries, err := os.ReadDir(s.workDir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestPushWorkingCopy_IsServedAndLeavesTheFileAlone(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 2)
	original, _ := os.ReadFile(path)

	got, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-edited"))
	if err != nil {
		t.Fatal(err)
	}
	if !got.Modified || got.UndoSteps != 1 || got.Path != path {
		t.Fatalf("document after push = %+v", got)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-edited" {
		t.Errorf("served %q, want the working copy", body)
	}
	if now, _ := os.ReadFile(path); !bytes.Equal(now, original) {
		t.Error("pushing a working copy changed the user's file")
	}
	if dir, _ := os.UserCacheDir(); !strings.HasPrefix(s.workDir, filepath.Join(dir, "lankir")) {
		t.Errorf("working copies in %q, want under the user cache dir", s.workDir)
	}
	if _, err := s.PushWorkingCopy(doc.ID, nil); err == nil {
		t.Error("an empty working copy was accepted")
	}
	if _, err := s.PushWorkingCopy("nope", []byte("%PDF")); err == nil {
		t.Error("unknown id accepted")
	}
}

// setInfo replaces the document information of the PDF at path with entries.
func setInfo(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	conf := model.NewDefaultConfiguration()
	conf.PreserveInfoDict = true
	ctx, err := api.ReadValidateAndOptimize(context.Background(), bytes.NewReader(data), conf, nil)
	if err != nil {
		t.Fatal(err)
	}
	info := types.NewDict()
	for k, v := range entries {
		info.InsertString(k, v)
	}
	if ctx.Info, err = ctx.IndRefForNewObject(info); err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if err := api.WriteContext(context.Background(), ctx, &b); err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, b.Bytes(), 0o644)
}

// infoOf returns the text entries of a PDF's document information.
func infoOf(t *testing.T, pdf []byte) map[string]string {
	t.Helper()
	ctx, err := api.ReadAndValidate(context.Background(), bytes.NewReader(pdf), model.NewDefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	if ctx.Info == nil {
		return got
	}
	d, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range d {
		if o, err := ctx.Dereference(v); err == nil {
			if s, err := types.StringOrHexLiteral(o); err == nil && s != nil {
				got[k] = *s
			}
		}
	}
	return got
}

// pdf.js' page editor drops the document information of merged files, stamps
// its own creator, producer and creation date (without "D:") on the rest, and
// leaves out the modification date.
func TestPushWorkingCopy_KeepsTheDocumentInformation(t *testing.T) {
	s := NewPDFService()
	dir := t.TempDir()
	path := filepath.Join(dir, "doc.pdf")
	writePagesPDF(t, path, 2)
	info := map[string]string{
		"Title": "Master Services Agreement", "Author": "Legal", "Producer": "Original Producer",
		"CreationDate": "D:20200101120000Z", "ModDate": "D:20210101120000Z", "Company": "Acme",
	}
	setInfo(t, path, info)
	doc, err := s.OpenPDFByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	built := filepath.Join(dir, "pdfjs.pdf")
	writePagesPDF(t, built, 3)
	setInfo(t, built, map[string]string{"Title": "Master Services Agreement", "Creator": "PDF.js", "Producer": "Firefox", "CreationDate": "20261115113421"})
	data, _ := os.ReadFile(built)

	before := time.Now().Add(-time.Second)
	if _, err := s.PushWorkingCopy(doc.ID, data); err != nil {
		t.Fatal(err)
	}
	body := served(t, s, doc.ID)
	got := infoOf(t, body)
	modified, ok := types.DateTime(got["ModDate"], false)
	if !ok || modified.Before(before) {
		t.Errorf("ModDate = %q, want the time of the change", got["ModDate"])
	}
	delete(got, "ModDate")
	want := maps.Clone(info)
	delete(want, "ModDate")
	if !maps.Equal(got, want) {
		t.Errorf("info = %v, want %v", got, want)
	}
	out := filepath.Join(dir, "served.pdf")
	writeFile(t, out, body, 0o600)
	if n, _ := pdfops.PageCount(out); n != 3 {
		t.Errorf("pages = %d, want the pushed 3", n)
	}

	// pdf.js' incremental save keeps the information, and pdfcpu rewriting it
	// would break the signatures it keeps.
	if _, err := s.PushWorkingCopy(doc.ID, body); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(served(t, s, doc.ID), body) {
		t.Error("a copy with the same information was rewritten")
	}
}

func TestUndoPageOp_StepsBackThroughWorkingCopies(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	original, _ := os.ReadFile(path)
	for _, v := range []string{"%PDF-1", "%PDF-2"} {
		if _, err := s.PushWorkingCopy(doc.ID, []byte(v)); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.UndoPageOp(doc.ID)
	if err != nil || !got.Modified || got.UndoSteps != 1 {
		t.Fatalf("first undo = %+v, %v", got, err)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-1" {
		t.Errorf("served %q after undo", body)
	}
	got, err = s.UndoPageOp(doc.ID)
	if err != nil || got.Modified || got.UndoSteps != 0 {
		t.Fatalf("second undo = %+v, %v", got, err)
	}
	if body := served(t, s, doc.ID); !bytes.Equal(body, original) {
		t.Error("undoing every step must serve the file again")
	}
	if got.RedoSteps != 2 {
		t.Errorf("redo steps = %d after undoing both, want 2", got.RedoSteps)
	}
	if _, err := s.UndoPageOp(doc.ID); err == nil {
		t.Error("undo with nothing to undo succeeded")
	}
}

func TestRedoPageOp_StepsForwardUntilANewChange(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 1)
	for _, v := range []string{"%PDF-1", "%PDF-2"} {
		if _, err := s.PushWorkingCopy(doc.ID, []byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.RedoPageOp(doc.ID); err == nil {
		t.Error("redo with nothing undone succeeded")
	}
	for range 2 {
		if _, err := s.UndoPageOp(doc.ID); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.RedoPageOp(doc.ID)
	if err != nil || !got.Modified || got.UndoSteps != 1 || got.RedoSteps != 1 {
		t.Fatalf("first redo = %+v, %v", got, err)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-1" {
		t.Errorf("served %q after the first redo", body)
	}
	got, err = s.RedoPageOp(doc.ID)
	if err != nil || got.UndoSteps != 2 || got.RedoSteps != 0 {
		t.Fatalf("second redo = %+v, %v", got, err)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-2" {
		t.Errorf("served %q after the second redo", body)
	}

	// A new change after an undo drops what was undone, as in any editor.
	if _, err := s.UndoPageOp(doc.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.PushWorkingCopy(doc.ID, []byte("%PDF-3"))
	if err != nil || got.RedoSteps != 0 {
		t.Fatalf("new change = %+v, %v", got, err)
	}
	if _, err := s.RedoPageOp(doc.ID); err == nil {
		t.Error("redo after a new change succeeded")
	}
	// The undone copy stays for DropPageOp until the change after.
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-4")); err != nil {
		t.Fatal(err)
	}
	if n := len(workFiles(t, s)); n != 3 {
		t.Errorf("%d copies on disk two changes after an undo, want 3", n)
	}
}

func TestDropPageOp_TakesBackTheNewestCopyAsIfNeverPushed(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 1)
	if _, err := s.DropPageOp(doc.ID); err == nil {
		t.Error("drop with nothing pushed succeeded")
	}
	for _, v := range []string{"%PDF-1", "%PDF-2"} {
		if _, err := s.PushWorkingCopy(doc.ID, []byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.UndoPageOp(doc.ID); err != nil {
		t.Fatal(err)
	}
	// The copy a failed operation built on replaced the redo step.
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-edits")); err != nil {
		t.Fatal(err)
	}

	got, err := s.DropPageOp(doc.ID)
	if err != nil || !got.Modified || got.UndoSteps != 1 || got.RedoSteps != 1 {
		t.Fatalf("drop = %+v, %v", got, err)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-1" {
		t.Errorf("served %q after the drop", body)
	}
	if n := len(workFiles(t, s)); n != 2 {
		t.Errorf("%d copies on disk after the drop, want 2", n)
	}
	if _, err := s.RedoPageOp(doc.ID); err != nil {
		t.Fatal(err)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-2" {
		t.Errorf("redo after the drop served %q, want the step undone before it", body)
	}
}

func TestUndoneCopies_GoWithSaveAndClose(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 1)
	push := func() {
		t.Helper()
		if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op")); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UndoPageOp(doc.ID); err != nil {
			t.Fatal(err)
		}
	}
	push()
	saved, err := s.SavePDF(doc.ID, []byte("%PDF-saved"), false)
	if err != nil {
		t.Fatal(err)
	}
	if saved.RedoSteps != 0 || len(workFiles(t, s)) != 0 {
		t.Errorf("save kept undone copies: %+v %v", saved, workFiles(t, s))
	}
	push()
	if err := s.ClosePDF(doc.ID); err != nil {
		t.Fatal(err)
	}
	if len(workFiles(t, s)) != 0 {
		t.Errorf("close kept undone copies: %v", workFiles(t, s))
	}
}

func TestWorkingCopies_KeepABoundedUndoHistory(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 1)
	for i := range maxUndoSteps + 5 {
		if _, err := s.PushWorkingCopy(doc.ID, fmt.Appendf(nil, "%%PDF-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(workFiles(t, s)); n != maxUndoSteps+1 {
		t.Errorf("%d copies on disk, want %d", n, maxUndoSteps+1)
	}
	var got *Document
	for range maxUndoSteps {
		var err error
		if got, err = s.UndoPageOp(doc.ID); err != nil {
			t.Fatal(err)
		}
	}
	// The oldest kept copy is the floor: still modified, nothing more to undo.
	if !got.Modified || got.UndoSteps != 0 {
		t.Fatalf("after %d undos: %+v", maxUndoSteps, got)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-4" {
		t.Errorf("floor serves %q", body)
	}
	if _, err := s.UndoPageOp(doc.ID); err == nil {
		t.Error("undo past the bounded history succeeded")
	}
}

func TestSaveAndClose_DropWorkingCopies(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op")); err != nil {
		t.Fatal(err)
	}
	saved, err := s.SavePDF(doc.ID, []byte("%PDF-saved"), false)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Modified || saved.UndoSteps != 0 {
		t.Errorf("saved document still modified: %+v", saved)
	}
	if got, _ := os.ReadFile(path); string(got) != "%PDF-saved" {
		t.Errorf("file = %q", got)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-saved" {
		t.Errorf("served %q after save", body)
	}
	if len(workFiles(t, s)) != 0 {
		t.Errorf("copies left after save: %v", workFiles(t, s))
	}

	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op2")); err != nil {
		t.Fatal(err)
	}
	if err := s.ClosePDF(doc.ID); err != nil {
		t.Fatal(err)
	}
	if len(workFiles(t, s)) != 0 {
		t.Errorf("copies left after close: %v", workFiles(t, s))
	}
}

func TestRevertToSaved_ServesTheFileOnDisk(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, []byte("%PDF-changed by someone else"), 0o644)

	got, err := s.RevertToSaved(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Modified || len(workFiles(t, s)) != 0 {
		t.Errorf("revert kept working copies: %+v %v", got, workFiles(t, s))
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-changed by someone else" {
		t.Errorf("served %q", body)
	}
	// Reverting reloads the file as it is now, so saving over it is no conflict.
	if _, err := s.SavePDF(doc.ID, []byte("%PDF-mine"), false); err != nil {
		t.Errorf("save after revert: %v", err)
	}
}

func TestRotatePages_TurnsTheCurrentCopy(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 3)
	original, _ := os.ReadFile(path)

	got, err := s.RotatePages(doc.ID, []int{1, 3}, 90)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Modified || got.UndoSteps != 1 {
		t.Errorf("after rotate: %+v", got)
	}
	want := []servedPage{{100, 90}, {110, 0}, {120, 90}}
	if pages := servedPages(t, s, doc.ID); fmt.Sprint(pages) != fmt.Sprint(want) {
		t.Errorf("pages = %v, want %v", pages, want)
	}
	// A second op builds on the first, not on the file.
	if _, err := s.RotatePages(doc.ID, []int{1}, -90); err != nil {
		t.Fatal(err)
	}
	want[0].rotate = 0
	if pages := servedPages(t, s, doc.ID); fmt.Sprint(pages) != fmt.Sprint(want) {
		t.Errorf("pages = %v, want %v", pages, want)
	}
	if now, _ := os.ReadFile(path); !bytes.Equal(now, original) {
		t.Error("rotate wrote the user's file")
	}
	if _, err := s.RotatePages(doc.ID, []int{9}, 90); err == nil {
		t.Error("out-of-range page accepted")
	}
	if got, _ := s.get(doc.ID); len(got.work) != 2 {
		t.Errorf("a failed op changed the history: %d copies", len(got.work))
	}
}

func TestRotatePages_PlainFileThatMentionsEncrypt(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	data, _ := os.ReadFile(path)
	writeFile(t, path, bytes.Replace(data, []byte("%PDF-1.7\n"), []byte("%PDF-1.7\n% /Encrypt\n"), 1), 0o644)
	if _, err := s.RotatePages(doc.ID, []int{1}, 90); err != nil {
		t.Fatal(err)
	}
}

func TestInsertBlankPage_AddsAPageAfter(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 2)
	if _, err := s.InsertBlankPage(doc.ID, 1); err != nil {
		t.Fatal(err)
	}
	want := []servedPage{{100, 0}, {100, 0}, {110, 0}}
	if pages := servedPages(t, s, doc.ID); fmt.Sprint(pages) != fmt.Sprint(want) {
		t.Errorf("pages = %v, want %v", pages, want)
	}
}

func TestSetMetadata_EditsTheCurrentCopy(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	m := pdfops.Metadata{Title: "T", Author: "A", Subject: "S", Keywords: "K"}
	got, err := s.SetMetadata(doc.ID, m)
	if err != nil || !got.Modified {
		t.Fatalf("SetMetadata = %+v, %v", got, err)
	}
	copyPath := filepath.Join(t.TempDir(), "copy.pdf")
	writeFile(t, copyPath, served(t, s, doc.ID), 0o644)
	if meta, err := pdfops.GetMetadata(copyPath); err != nil || meta.Title != "T" || meta.Keywords != "K" {
		t.Errorf("served metadata = %+v, %v", meta, err)
	}
	if meta, _ := pdfops.GetMetadata(path); meta.Title == "T" {
		t.Error("metadata written to the user's file before saving")
	}
}

func TestSaveOptions_ProtectAndOptimizeTheNextWrite(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 2)
	plain, _ := os.ReadFile(path)

	if err := s.SetSaveOptions(doc.ID, SaveOptions{Rewrite: true, Password: "secret", Optimize: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePDF(doc.ID, plain, false); err != nil {
		t.Fatal(err)
	}
	if _, err := pdfops.PageCount(path); err == nil {
		t.Fatal("protected save is readable without a password")
	}
	dec := filepath.Join(t.TempDir(), "dec.pdf")
	if err := pdfops.Decrypt(path, dec, "secret"); err != nil {
		t.Fatalf("decrypt with the password: %v", err)
	}
	if n, _ := pdfops.PageCount(dec); n != 2 {
		t.Errorf("decrypted pages = %d", n)
	}

	// Options apply to one write only: these encrypted bytes are written as they are.
	encrypted, _ := os.ReadFile(path)
	if _, err := s.SavePDF(doc.ID, encrypted, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, encrypted) {
		t.Error("a save without options changed the bytes")
	}

	// A rewrite without a password decrypts, with the password the save set.
	if err := s.SetSaveOptions(doc.ID, SaveOptions{Rewrite: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePDF(doc.ID, encrypted, false); err != nil {
		t.Fatal(err)
	}
	if n, err := pdfops.PageCount(path); err != nil || n != 2 {
		t.Errorf("unprotected save: %d, %v", n, err)
	}
	if err := s.SetSaveOptions("nope", SaveOptions{}); err == nil {
		t.Error("unknown id accepted")
	}
}

func TestPageOpsOnAProtectedFile_UseItsPassword(t *testing.T) {
	s := NewPDFService()
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.pdf")
	writePagesPDF(t, plain, 2)
	path := filepath.Join(dir, "locked.pdf")
	if err := pdfops.Encrypt(plain, path, "user", "owner"); err != nil {
		t.Fatal(err)
	}
	doc, err := s.OpenPDFByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RotatePages(doc.ID, []int{2}, 90); err == nil {
		t.Fatal("rotated a protected file without its password")
	}
	if err := s.SetPassword(doc.ID, "user"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RotatePages(doc.ID, []int{2}, 90); err != nil {
		t.Fatal(err)
	}
	// The copy is decrypted; saving protects it again (see SaveOptions).
	want := []servedPage{{100, 0}, {110, 90}}
	if pages := servedPages(t, s, doc.ID); fmt.Sprint(pages) != fmt.Sprint(want) {
		t.Errorf("pages = %v, want %v", pages, want)
	}
	if _, err := s.InsertBlankPage(doc.ID, 2); err != nil {
		t.Fatalf("op on the decrypted copy: %v", err)
	}
}

func TestExportPDF_WritesOnlyChosenNewFiles(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	dir := t.TempDir()
	target := filepath.Join(dir, "part.pdf")

	if err := s.ExportPDF(doc.ID, target, []byte("%PDF-x"), false); err == nil {
		t.Fatal("export to a path no dialog chose succeeded")
	}
	s.chooseSaveAsPath(doc.ID, target)
	if err := s.ExportPDF(doc.ID, target, []byte("%PDF-x"), false); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(target); string(got) != "%PDF-x" {
		t.Errorf("exported %q", got)
	}
	if got, _ := s.get(doc.ID); got.Path != path || got.Modified {
		t.Errorf("export retargeted the document: %+v", got)
	}

	s.chooseExportDir(doc.ID, dir)
	other := filepath.Join(dir, "doc_part2.pdf")
	if err := s.ExportPDF(doc.ID, other, []byte("%PDF-2"), false); err != nil {
		t.Fatal(err)
	}
	var conflict *ConflictError
	if err := s.ExportPDF(doc.ID, other, []byte("%PDF-3"), false); !errors.As(err, &conflict) || conflict.Reason != ConflictExists {
		t.Errorf("existing file: %v", err)
	}
	if err := s.ExportPDF(doc.ID, other, []byte("%PDF-3"), true); err != nil {
		t.Errorf("overwrite: %v", err)
	}
	for _, bad := range []string{filepath.Join(dir, "sub", "x.pdf"), filepath.Join(dir, "x.txt"), filepath.Join(t.TempDir(), "x.pdf")} {
		if err := s.ExportPDF(doc.ID, bad, []byte("%PDF"), false); err == nil {
			t.Errorf("export to %s succeeded", bad)
		}
	}
	s.chooseExportDir(doc.ID, filepath.Dir(path))
	if err := s.ExportPDF(doc.ID, path, []byte("%PDF"), true); !errors.As(err, &conflict) || conflict.Reason != ConflictOpen {
		t.Errorf("export over an open document: %v", err)
	}
}

func TestExportPDF_AppliesTheSaveOptions(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 2)
	plain, _ := os.ReadFile(path)
	dir := t.TempDir()
	s.chooseExportDir(doc.ID, dir)

	// Split from a protected document: each part keeps its password.
	part := filepath.Join(dir, "doc_part1.pdf")
	if err := s.SetSaveOptions(doc.ID, SaveOptions{Rewrite: true, Password: "secret"}); err != nil {
		t.Fatal(err)
	}
	if err := s.ExportPDF(doc.ID, part, plain, false); err != nil {
		t.Fatal(err)
	}
	if _, err := pdfops.PageCount(part); err == nil {
		t.Fatal("the protected part is readable without a password")
	}
	dec := filepath.Join(t.TempDir(), "dec.pdf")
	if err := pdfops.Decrypt(part, dec, "secret"); err != nil {
		t.Fatalf("decrypt with the password: %v", err)
	}

	// The options were for that write only.
	next := filepath.Join(dir, "doc_part2.pdf")
	if err := s.ExportPDF(doc.ID, next, plain, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(next); !bytes.Equal(got, plain) {
		t.Error("an export without options changed the bytes")
	}
	if _, err := s.SavePDF(doc.ID, plain, false); err != nil {
		t.Fatal(err)
	}
	if n, err := pdfops.PageCount(path); err != nil || n != 2 {
		t.Errorf("the export's options reached the next save: %d, %v", n, err)
	}
}

func TestServeHTTP_PutWorkingCopyAndExport(t *testing.T) {
	s := NewPDFService()
	doc, path := openPages(t, s, 1)
	put := func(target, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, target, strings.NewReader(body)))
		return rec
	}

	rec := put("/"+doc.ID+"?work=1", "%PDF-op")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"modified":true`) {
		t.Fatalf("work: %d %s", rec.Code, rec.Body)
	}
	if body := served(t, s, doc.ID); string(body) != "%PDF-op" {
		t.Errorf("served %q", body)
	}

	target := filepath.Join(t.TempDir(), "out.pdf")
	s.chooseSaveAsPath(doc.ID, target)
	rec = put("/"+doc.ID+"?export="+url.QueryEscape(target), "%PDF-out")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body)
	}
	rec = put("/"+doc.ID+"?export="+url.QueryEscape(target), "%PDF-again")
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"conflict":"exists"`) {
		t.Errorf("export over existing: %d %s", rec.Code, rec.Body)
	}
	if rec = put("/"+doc.ID+"?export="+url.QueryEscape(target)+"&overwrite=1", "%PDF-again"); rec.Code != http.StatusOK {
		t.Errorf("export overwrite: %d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(path); strings.HasPrefix(string(got), "%PDF-op") {
		t.Error("working copy written to the user's file")
	}
}

// Working copies of protected files are decrypted, and a crash or a kill
// skips ServiceShutdown.
func TestServiceStartup_RemovesTheCopiesOfSessionsThatEnded(t *testing.T) {
	base, err := workBase()
	if err != nil {
		t.Fatal(err)
	}
	ended := exec.Command(os.Args[0], "-test.run=^$")
	if err := ended.Run(); err != nil {
		t.Fatal(err)
	}
	host := sessionHost()
	stale := filepath.Join(base, fmt.Sprintf("session-%s-%d-1", host, ended.Process.Pid))
	// A window opened with Ctrl+Shift+N is a process of its own.
	live := filepath.Join(base, fmt.Sprintf("session-%s-%d-1", host, os.Getppid()))
	// Another host sharing the home (NFS) can't be asked about its processes.
	otherHost := filepath.Join(base, fmt.Sprintf("session-%x-%d-1", "another-host", ended.Process.Pid))
	// Named as before, without the host or the process id: whose it is can't be told.
	noHost := filepath.Join(base, fmt.Sprintf("session-%d-1", ended.Process.Pid))
	unknown := filepath.Join(base, "session-467988103")
	kept := []string{live, otherHost, noHost, unknown}
	for _, dir := range append([]string{stale}, kept...) {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(dir, "doc-1.pdf"), []byte("%PDF-plain"), 0o600)
	}
	t.Cleanup(func() {
		for _, dir := range kept {
			os.RemoveAll(dir)
		}
	})

	if err := NewPDFService().ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("the ended session's dir is still there: %v", err)
	}
	for _, dir := range kept {
		if _, err := os.Stat(filepath.Join(dir, "doc-1.pdf")); err != nil {
			t.Errorf("a session that may be running lost its copies: %v", err)
		}
	}
}

func TestServiceShutdown_RemovesTheSessionDir(t *testing.T) {
	s := NewPDFService()
	doc, _ := openPages(t, s, 1)
	if _, err := s.PushWorkingCopy(doc.ID, []byte("%PDF-op")); err != nil {
		t.Fatal(err)
	}
	dir := s.workDir
	if err := s.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("session dir %s still exists: %v", dir, err)
	}
}
