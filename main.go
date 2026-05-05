package main

import (
	"context"
	"embed"
	"log"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/Matbe34/lankir/cmd/cli"
	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/pdf"
	"github.com/Matbe34/lankir/internal/signature"
)

//go:embed all:frontend/dist
var assets embed.FS

// parseArgs splits process args into CLI args (route to Cobra) vs GUI files
// (open as tabs in the GUI). Cobra subcommand or any leading `-` flag → CLI.
// Otherwise everything is treated as a GUI file path.
func parseArgs(args []string) (cliArgs, guiFiles []string) {
	if len(args) == 0 {
		return nil, nil
	}
	for _, a := range args {
		if strings.HasPrefix(a, "-") {
			return args, nil
		}
		if cli.IsKnownSubcommand(a) {
			return args, nil
		}
		break
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

func runGUI(initialFiles []string) {
	skipLock := os.Getenv("LANKIR_NEW_WINDOW") == "1"

	app := NewApp()
	app.initialFiles = initialFiles

	configService, err := config.NewService()
	if err != nil {
		log.Fatal("Failed to create config service:", err)
	}

	pdfService := pdf.NewPDFService(configService)
	recentFilesService := pdf.NewRecentFilesService()
	signatureService := signature.NewSignatureService(configService)

	onStartup := func(ctx context.Context) {
		app.startup(ctx)
		pdfService.Startup(ctx)
		recentFilesService.Startup(ctx)
		signatureService.Startup(ctx)

		// Drag-drop is handled in the frontend via HTML5 dragover/drop events
		// (see frontend/src/js/fileOpener.js::registerDragDrop). Wails v2.10.2's
		// native Linux DragAndDrop.EnableFileDrop is broken — its GTK handler
		// returns FALSE, so WebKit's default file-navigation hijacks the
		// window. Bypassing it entirely keeps drag-drop working.

		// Hand off any startup files (from CLI args or OS "Open with") to the
		// frontend via the same event used by SingleInstanceLock.
		if len(app.initialFiles) > 0 {
			runtime.EventsEmit(ctx, "open-files", app.initialFiles)
		}
	}

	opts := &options.App{
		Title:  "Lankir",
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        onStartup,
		Bind: []interface{}{
			app,
			pdfService,
			recentFilesService,
			signatureService,
			configService,
		},
		Linux: &linux.Options{
			Icon:                []byte{},
			WindowIsTranslucent: false,
			WebviewGpuPolicy:    linux.WebviewGpuPolicyAlways,
		},
	}

	if !skipLock {
		opts.SingleInstanceLock = &options.SingleInstanceLock{
			UniqueId:               "com.lankir.singleinstance",
			OnSecondInstanceLaunch: app.onSecondInstance,
		}
	}

	if err := wails.Run(opts); err != nil {
		log.Fatal("Error:", err.Error())
	}
}
