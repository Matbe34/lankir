package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App provides system dialog functionality to the frontend.
// It wraps the Wails runtime methods with a consistent context
// for file and directory selection dialogs.
type App struct {
	ctx context.Context
}

// NewApp creates a new App instance.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenDirectoryDialog displays a native directory selection dialog.
// Returns the selected directory path or an empty string if cancelled.
func (a *App) OpenDirectoryDialog(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
}

// OpenFileDialog displays a native file selection dialog with optional file type filters.
// Returns the selected file path or an empty string if cancelled.
func (a *App) OpenFileDialog(title string, filters []runtime.FileFilter) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
}

// ShowMessageDialog displays a native message dialog to the user.
// This is useful for showing alerts, confirmations, or error messages.
func (a *App) ShowMessageDialog(title, message string) error {
	_, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.InfoDialog,
		Title:   title,
		Message: message,
	})
	return err
}
