package main

import (
	"context"
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"

	"github.com/ferran/pdf_app/cmd/cli"
	"github.com/ferran/pdf_app/internal/config"
	"github.com/ferran/pdf_app/internal/pdf"
	"github.com/ferran/pdf_app/internal/signature"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if len(os.Args) == 1 {
		runGUI()
		return
	}

	cli.Execute(runGUI)
}

func runGUI() {
	// Create an instance of the app structure
	app := NewApp()

	// Create config service
	configService, err := config.NewService()
	if err != nil {
		log.Fatal("Failed to create config service:", err)
	}

	// Create PDF service with config service
	pdfService := pdf.NewPDFService(configService)

	// Create recent files service
	recentFilesService := pdf.NewRecentFilesService()

	// Create signature service
	signatureService := signature.NewSignatureService(configService)

	// Create startup function that initializes all services
	onStartup := func(ctx context.Context) {
		app.startup(ctx)
		pdfService.Startup(ctx)
		recentFilesService.Startup(ctx)
		signatureService.Startup(ctx)
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:  "PDF App",
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
