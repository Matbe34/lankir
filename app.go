package main

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App exposes system dialogs to the frontend via Wails bindings.
type App struct {
	ctx          context.Context
	initialFiles []string
}

// NewApp creates a new App instance.
func NewApp() *App {
	return &App{}
}

// startup stores the app context. Called by Wails on app start.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenDirectoryDialog shows a native directory picker and returns the selected path.
func (a *App) OpenDirectoryDialog(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
}

// OpenFileDialog shows a native file picker with optional filters.
func (a *App) OpenFileDialog(title string, filters []runtime.FileFilter) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
}

// ShowMessageDialog displays a native info dialog with the given title and message.
func (a *App) ShowMessageDialog(title, message string) error {
	_, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.InfoDialog,
		Title:   title,
		Message: message,
	})
	return err
}

// filterPDFPaths returns only paths whose extension is .pdf (case-insensitive).
func filterPDFPaths(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if strings.EqualFold(filepath.Ext(p), ".pdf") {
			out = append(out, p)
		}
	}
	return out
}

// onFileDrop is the Wails drag-drop callback. Filters non-PDFs and forwards
// the path list to the frontend via the "open-files" event. Empty filtered
// lists still emit so the frontend can show a "no PDF files" toast.
func (a *App) onFileDrop(_, _ int, paths []string) {
	pdfs := filterPDFPaths(paths)
	runtime.EventsEmit(a.ctx, "open-files", pdfs)
}
