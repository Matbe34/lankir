package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options"
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

// resolveSecondInstancePaths takes args from a second-instance launch (which
// may be relative to that process's working directory) and returns absolute
// paths to PDFs only. The .pdf filter ensures we never emit non-PDF paths
// even if a user explicitly passes one on the second-instance command line.
func resolveSecondInstancePaths(args []string, cwd string) []string {
	pdfs := filterPDFPaths(args)
	out := make([]string, 0, len(pdfs))
	for _, p := range pdfs {
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		out = append(out, p)
	}
	return out
}

// onSecondInstance is the Wails SingleInstanceLock callback. Forwards the
// args from a second-launch process to the frontend as "open-files".
func (a *App) onSecondInstance(data options.SecondInstanceData) {
	paths := resolveSecondInstancePaths(data.Args, data.WorkingDirectory)
	runtime.EventsEmit(a.ctx, "open-files", paths)
}

// newWindowEnv returns a copy of env with any prior LANKIR_NEW_WINDOW entry
// removed and a single LANKIR_NEW_WINDOW=1 appended. The child process uses
// this signal to skip SingleInstanceLock acquisition (wired in main.go).
func newWindowEnv(env []string) []string {
	out := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, "LANKIR_NEW_WINDOW=") {
			out = append(out, e)
		}
	}
	return append(out, "LANKIR_NEW_WINDOW=1")
}

// OpenInNewWindow spawns a detached lankir process with the same executable
// and the given file path as an argument. Bypasses SingleInstanceLock via
// LANKIR_NEW_WINDOW=1. Empty filePath spawns an empty new window.
//
// Exported because the frontend calls it via Wails bindings (App.OpenInNewWindow).
func (a *App) OpenInNewWindow(filePath string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{}
	if filePath != "" {
		args = append(args, filePath)
	}
	cmd := exec.Command(exe, args...)
	cmd.Env = newWindowEnv(os.Environ())
	return cmd.Start()
}
