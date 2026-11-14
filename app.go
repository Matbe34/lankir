package main

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/Matbe34/lankir/internal/version"
)

// App exposes system dialogs and file hand-off to the frontend.
type App struct {
	// emit sends a Wails event to the frontend; set by runGUI, replaced in tests.
	emit func(name string, data ...any) bool

	mu            sync.Mutex
	pendingFiles  []string
	frontendReady bool

	unsavedSeq     int64
	unsaved        atomic.Bool
	closeConfirmed atomic.Bool
}

// SetUnsavedChanges tells Go whether any tab has unsaved edits, so closing
// the window asks the frontend first. Each binding call runs on its own
// goroutine, so seq (increasing per call) drops reports that arrive late.
func (a *App) SetUnsavedChanges(seq int64, unsaved bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if seq <= a.unsavedSeq {
		return
	}
	a.unsavedSeq = seq
	a.unsaved.Store(unsaved)
}

// ConfirmClose closes the main window once the frontend has dealt with
// unsaved edits.
func (a *App) ConfirmClose() {
	a.closeConfirmed.Store(true)
	if w, ok := application.Get().Window.GetByName(mainWindowName); ok {
		w.Close()
	}
}

// LogFrontend writes webview console output to the app log. The frontend
// only forwards it when debug mode is on.
func (a *App) LogFrontend(level, message string) {
	switch level {
	case "error":
		slog.Error("frontend", "msg", message)
	case "warn":
		slog.Warn("frontend", "msg", message)
	default:
		slog.Info("frontend", "msg", message)
	}
}

// Version returns the version this binary was built as, for the settings dialog.
func (a *App) Version() string {
	return version.Version
}

// interceptClose reports whether a window close must be held back; if so it
// asks the frontend with "close-requested".
func (a *App) interceptClose() bool {
	if !a.unsaved.Load() || a.closeConfirmed.Load() {
		return false
	}
	a.emit("close-requested")
	return true
}

// NewApp creates an App holding the files passed on the command line until
// the frontend asks for them.
func NewApp(initialFiles []string) *App {
	return &App{pendingFiles: initialFiles}
}

// TakeStartupFiles returns the files queued before the frontend was ready and
// switches to emitting "open-files" for later ones. The frontend calls it once
// after registering its "open-files" listener, so nothing is lost to the race
// between Go startup and the page loading.
func (a *App) TakeStartupFiles() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	files := a.pendingFiles
	a.pendingFiles = nil
	a.frontendReady = true
	slog.Debug("frontend took startup files", "paths", files)
	if files == nil {
		return []string{}
	}
	return files
}

// openFiles hands paths to the frontend, queueing them until it is ready.
func (a *App) openFiles(paths []string) {
	a.mu.Lock()
	if !a.frontendReady {
		a.pendingFiles = append(a.pendingFiles, paths...)
		a.mu.Unlock()
		slog.Debug("queued open-files until frontend is ready", "paths", paths)
		return
	}
	a.mu.Unlock()
	slog.Debug("emitting open-files", "paths", paths)
	a.emit("open-files", paths)
}

// OpenDirectoryDialog shows a native directory picker and returns the selected path.
func (a *App) OpenDirectoryDialog(title string) (string, error) {
	return application.Get().Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		PromptForSingleSelection()
}

// OpenFileDialog shows a native file picker with optional filters.
func (a *App) OpenFileDialog(title string, filters []application.FileFilter) (string, error) {
	dialog := application.Get().Dialog.OpenFile().SetTitle(title)
	for _, f := range filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}
	return dialog.PromptForSingleSelection()
}

// ShowMessageDialog displays a native info dialog with the given title and message.
func (a *App) ShowMessageDialog(title, message string) error {
	application.Get().Dialog.Info().SetTitle(title).SetMessage(message).Show()
	return nil
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

// onFilesDropped forwards the PDFs of a window drop as "open-files". A drop
// with files but no PDFs still emits (empty) so the frontend can say so; a
// drop with no files at all is ignored.
func (a *App) onFilesDropped(paths []string) {
	if len(paths) == 0 {
		return
	}
	a.openFiles(filterPDFPaths(paths))
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

// onSecondInstance forwards the PDFs of a second launch to this instance.
// Wails passes the second process's full os.Args, program name included.
// A bare relaunch emits nothing so it doesn't pop a "No PDF files" toast.
func (a *App) onSecondInstance(data application.SecondInstanceData) {
	args := data.Args
	if len(args) > 0 {
		args = args[1:]
	}
	paths := resolveSecondInstancePaths(args, data.WorkingDir)
	if len(paths) == 0 {
		return
	}
	a.openFiles(paths)
}

// newWindowEnv returns a copy of env with any prior LANKIR_NEW_WINDOW entry
// removed and a single LANKIR_NEW_WINDOW=1 appended. The child process uses
// this signal to skip the single-instance lock (wired in main.go).
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
// and the given file path as an argument. Bypasses the single-instance lock via
// LANKIR_NEW_WINDOW=1. Empty filePath spawns an empty new window.
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
