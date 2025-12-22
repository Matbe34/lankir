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

	"github.com/Matbe34/lankir/cmd/cli"
	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/pdf"
	"github.com/Matbe34/lankir/internal/signature"
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
