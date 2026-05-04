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
	if len(os.Args) == 1 {
		runGUI()
		return
	}

	// Windows-only: reattach stdout/stderr to the parent console so CLI output
	// from cmd/PowerShell appears even though the binary uses the GUI subsystem.
	// No-op on Linux/macOS.
	attachParentConsole()

	cli.Execute(runGUI)
}

func runGUI() {
	app := NewApp()

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
	}

	err = wails.Run(&options.App{
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
	})

	if err != nil {
		log.Fatal("Error:", err.Error())
	}
}
