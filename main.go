package main

import (
	"embed"
	"log"
	"log/slog"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/Matbe34/lankir/cmd/cli"
	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/pdf"
	"github.com/Matbe34/lankir/internal/signature"
)

const mainWindowName = "main"

//go:embed all:frontend/dist
var assets embed.FS

// parseArgs splits process args into CLI args (route to Cobra) vs GUI files
// (open as tabs in the GUI). Cobra subcommand or any leading `-` flag → CLI.
// Otherwise everything is treated as a GUI file path.
func parseArgs(args []string) (cliArgs, guiFiles []string) {
	if len(args) == 0 {
		return nil, nil
	}
	if strings.HasPrefix(args[0], "-") || cli.IsKnownSubcommand(args[0]) {
		return args, nil
	}
	return nil, args
}

func main() {
	cliArgs, guiFiles := parseArgs(os.Args[1:])
	if cliArgs == nil {
		runGUI(guiFiles)
		return
	}

	// Windows-only: reattach stdout/stderr to the parent console so CLI output
	// from cmd/PowerShell appears even though the binary uses the GUI subsystem.
	// No-op on Linux/macOS.
	attachParentConsole()

	cli.ExecuteWithArgs(cliArgs, runGUI)
}

// webviewGpuPolicy maps the Hardware acceleration setting to WebKit's
// policy. The webview is made once, so a change applies after a restart.
func webviewGpuPolicy(cfg *config.Config) application.WebviewGpuPolicy {
	if cfg.HardwareAccel {
		return application.WebviewGpuPolicyAlways
	}
	return application.WebviewGpuPolicyNever
}

func runGUI(initialFiles []string) {
	configService, err := config.NewService()
	if err != nil {
		log.Fatal("Failed to create config service:", err)
	}
	cfg := configService.Get()
	if cfg.DebugMode {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	app := NewApp(initialFiles)
	pdfService := pdf.NewPDFService()
	recentFilesService := pdf.NewRecentFilesService()
	signatureService := signature.NewSignatureService(configService)

	opts := application.Options{
		Name:        "Lankir",
		Description: "PDF viewer and signer",
		// Wails' own debug log prints every binding call's arguments, PINs
		// included, so it stays at Info even when the app logs debug.
		LogLevel: slog.LevelInfo,
		Services: []application.Service{
			application.NewService(app),
			application.NewServiceWithOptions(pdfService, application.ServiceOptions{Route: pdf.DocumentRoute}),
			application.NewService(recentFilesService),
			application.NewService(signatureService),
			application.NewService(configService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Linux: application.LinuxOptions{
			// Also the program name, so the Wayland app_id and the X11 WM_CLASS
			// match packaging/com.lankir.Lankir.desktop.
			ApplicationID: "com.lankir.Lankir",
		},
	}

	// A window opened with Ctrl+Shift+N is its own process and must not take
	// (or forward to) the single-instance lock.
	if os.Getenv("LANKIR_NEW_WINDOW") != "1" && singleInstanceAvailable() {
		opts.SingleInstance = &application.SingleInstanceOptions{
			UniqueID: "com.lankir.singleinstance",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				app.onSecondInstance(data)
				if w, ok := application.Get().Window.GetByName(mainWindowName); ok {
					w.Restore()
					w.Focus()
				}
			},
		}
	}

	wailsApp := application.New(opts)
	app.emit = wailsApp.Event.Emit

	// Fires on macOS Finder opens. On Linux/Windows it needs Options.FileAssociations,
	// which we leave unset: file args already arrive through parseArgs.
	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(e *application.ApplicationEvent) {
		app.openFiles([]string{e.Context().Filename()})
	})

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             mainWindowName,
		Title:            "Lankir",
		Width:            1400,
		Height:           900,
		BackgroundColour: application.NewRGB(27, 38, 54),
		EnableFileDrop:   true,
		// Wails on Linux swallows these before the webview gets a keydown, so
		// the frontend routes them to text fields or the pdf.js editor itself.
		KeyBindings: map[string]func(application.Window){
			"CmdOrCtrl+Z":       func(application.Window) { app.emit("edit-command", "undo") },
			"CmdOrCtrl+Shift+Z": func(application.Window) { app.emit("edit-command", "redo") },
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: webviewGpuPolicy(cfg),
		},
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		app.onFilesDropped(e.Context().DroppedFiles())
	})
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if app.interceptClose() {
			e.Cancel()
		}
	})

	if err := wailsApp.Run(); err != nil {
		log.Fatal("Error:", err.Error())
	}
}
