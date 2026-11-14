package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type emitted struct {
	name string
	data []any
}

func newTestApp(initial []string) (*App, *[]emitted) {
	var events []emitted
	app := NewApp(initial)
	app.emit = func(name string, data ...any) bool {
		events = append(events, emitted{name, data})
		return false
	}
	return app, &events
}

func TestTakeStartupFiles_ReturnsInitialFilesOnce(t *testing.T) {
	app, events := newTestApp([]string{"a.pdf", "b.pdf"})

	if got := app.TakeStartupFiles(); !reflect.DeepEqual(got, []string{"a.pdf", "b.pdf"}) {
		t.Errorf("first take: got %v", got)
	}
	if got := app.TakeStartupFiles(); len(got) != 0 {
		t.Errorf("second take should be empty, got %v", got)
	}
	if len(*events) != 0 {
		t.Errorf("startup files must not be emitted, got %v", *events)
	}
}

func TestInterceptClose(t *testing.T) {
	app, events := newTestApp(nil)

	if app.interceptClose() {
		t.Error("nothing unsaved: close must go ahead")
	}
	app.SetUnsavedChanges(1, true)
	if !app.interceptClose() {
		t.Error("unsaved changes: close must be held")
	}
	want := []emitted{{"close-requested", nil}}
	if !reflect.DeepEqual(*events, want) {
		t.Errorf("got %v want %v", *events, want)
	}
	app.closeConfirmed.Store(true)
	if app.interceptClose() {
		t.Error("confirmed close must go ahead")
	}
}

func TestSetUnsavedChanges_IgnoresStaleCalls(t *testing.T) {
	app, _ := newTestApp(nil)

	// Each binding call runs on its own goroutine, so they can land out of order.
	app.SetUnsavedChanges(2, false)
	app.SetUnsavedChanges(1, true)
	if app.unsaved.Load() {
		t.Error("an older report overrode a newer one")
	}
	app.SetUnsavedChanges(3, true)
	if !app.unsaved.Load() {
		t.Error("a newer report was ignored")
	}
}

func TestOpenFiles_QueuedUntilFrontendTakesThem(t *testing.T) {
	app, events := newTestApp([]string{"start.pdf"})

	app.openFiles([]string{"/early.pdf"})
	if len(*events) != 0 {
		t.Fatalf("emitted before frontend was ready: %v", *events)
	}

	if got := app.TakeStartupFiles(); !reflect.DeepEqual(got, []string{"start.pdf", "/early.pdf"}) {
		t.Errorf("take: got %v", got)
	}

	app.openFiles([]string{"/late.pdf"})
	want := []emitted{{"open-files", []any{[]string{"/late.pdf"}}}}
	if !reflect.DeepEqual(*events, want) {
		t.Errorf("got %v want %v", *events, want)
	}
}

func TestOnFilesDropped(t *testing.T) {
	app, events := newTestApp(nil)
	app.TakeStartupFiles()

	app.onFilesDropped(nil)
	if len(*events) != 0 {
		t.Fatalf("empty drop must not emit, got %v", *events)
	}

	app.onFilesDropped([]string{"/x/a.txt"})
	app.onFilesDropped([]string{"/x/a.PDF", "/x/b.png", "/x/c.pdf"})
	want := []emitted{
		{"open-files", []any{[]string{}}},
		{"open-files", []any{[]string{"/x/a.PDF", "/x/c.pdf"}}},
	}
	if !reflect.DeepEqual(*events, want) {
		t.Errorf("got %v want %v", *events, want)
	}
}

func TestOnSecondInstance(t *testing.T) {
	app, events := newTestApp(nil)
	app.TakeStartupFiles()
	cwd := t.TempDir()

	app.onSecondInstance(application.SecondInstanceData{Args: []string{"/usr/bin/lankir"}, WorkingDir: cwd})
	if len(*events) != 0 {
		t.Fatalf("bare relaunch must not emit, got %v", *events)
	}

	app.onSecondInstance(application.SecondInstanceData{
		Args:       []string{"/opt/lankir.pdf", "rel.pdf", "/abs/x.pdf", "notes.txt"},
		WorkingDir: cwd,
	})
	want := []emitted{{"open-files", []any{[]string{filepath.Join(cwd, "rel.pdf"), "/abs/x.pdf"}}}}
	if !reflect.DeepEqual(*events, want) {
		t.Errorf("got %v want %v", *events, want)
	}
}

func TestFilterPDFPaths(t *testing.T) {
	got := filterPDFPaths([]string{"a.pdf", "b.txt", "C.PDF", "/x/y/z.png", "doc.pdf"})
	want := []string{"a.pdf", "C.PDF", "doc.pdf"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestResolveSecondInstancePaths(t *testing.T) {
	cwd, err := os.MkdirTemp("", "lankir-test-cwd-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(cwd)

	abs := filepath.Join(cwd, "abs.pdf")
	got := resolveSecondInstancePaths([]string{"rel.pdf", abs, "other.txt"}, cwd)

	want := []string{
		filepath.Join(cwd, "rel.pdf"),
		abs,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestNewWindowEnv(t *testing.T) {
	in := []string{"PATH=/bin", "LANKIR_NEW_WINDOW=1", "HOME=/root", "LANKIR_NEW_WINDOW=stale"}
	got := newWindowEnv(in)

	// Must contain exactly one LANKIR_NEW_WINDOW=1 (we strip any prior and re-add).
	count := 0
	for _, e := range got {
		if e == "LANKIR_NEW_WINDOW=1" {
			count++
		}
		if strings.HasPrefix(e, "LANKIR_NEW_WINDOW=") && e != "LANKIR_NEW_WINDOW=1" {
			t.Errorf("non-canonical LANKIR_NEW_WINDOW entry: %q", e)
		}
	}
	if count != 1 {
		t.Errorf("expected exactly one LANKIR_NEW_WINDOW=1; got %d in %v", count, got)
	}

	// Other env entries preserved.
	hasPath, hasHome := false, false
	for _, e := range got {
		if e == "PATH=/bin" {
			hasPath = true
		}
		if e == "HOME=/root" {
			hasHome = true
		}
	}
	if !hasPath || !hasHome {
		t.Errorf("non-LANKIR env not preserved: %v", got)
	}
}
