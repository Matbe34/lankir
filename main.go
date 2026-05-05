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

		// Wire drag-drop. Wails calls app.onFileDrop with absolute paths
		// whenever the user drops files onto the window.
		runtime.OnFileDrop(ctx, app.onFileDrop)

		// Hand off any startup files (from CLI args or OS "Open with") to
		// the frontend via the same event drop and second-instance use.
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
		DragAndDrop: &options.DragAndDrop{
			// EnableFileDrop installs a Wails-side drop callback that fires only on
			// elements marked with --wails-drop-target: drop. Drops on any other
			// element fall through to the WebView (which would try to navigate to
			// the file). To avoid that, the CSS marker covers the entire body in
			// style.css. Do NOT also set DisableWebViewDrop: that calls
			// gtk_drag_dest_unset on Linux/GTK and prevents the drag-drop signal
			// from firing at all, which silently disables drop everywhere.
			EnableFileDrop: true,
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
