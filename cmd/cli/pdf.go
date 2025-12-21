package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ferran/lankir/internal/pdf"
	"github.com/spf13/cobra"
)

var pdfCmd = &cobra.Command{
	Use:   "pdf",
	Short: "PDF operations",
	Long:  `Perform various operations on PDF files including viewing metadata, rendering pages, and generating thumbnails.`,
}

var pdfInfoCmd = &cobra.Command{
	Use:   "info <pdf-file>",
	Short: "Display PDF metadata",
	Long:  `Display metadata information for a PDF file including title, author, page count, and dimensions.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		service := pdf.NewPDFService(nil)
		service.Startup(context.Background())

		metadata, err := service.OpenPDFByPath(pdfPath)
		if err != nil {
			ExitWithError("failed to open PDF", err)
		}
		defer service.ClosePDF()

		GetLogger().Info("PDF metadata retrieved", "file", pdfPath, "pages", metadata.PageCount)

		if jsonOutput {
			data, err := json.MarshalIndent(metadata, "", "  ")
			if err != nil {
				ExitWithError("failed to marshal PDF metadata to JSON", err)
			}
			fmt.Println(string(data))
		} else {
			fmt.Printf("PDF Information:\n")
			fmt.Printf("  File:       %s\n", metadata.FilePath)
			fmt.Printf("  Title:      %s\n", metadata.Title)
			fmt.Printf("  Author:     %s\n", metadata.Author)
			fmt.Printf("  Subject:    %s\n", metadata.Subject)
			fmt.Printf("  Creator:    %s\n", metadata.Creator)
			fmt.Printf("  Pages:      %d\n", metadata.PageCount)
		}
	},
}

var pdfPagesCmd = &cobra.Command{
	Use:   "pages <pdf-file>",
	Short: "Display page dimensions",
	Long:  `Display dimensions for each page in the PDF file.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		service := pdf.NewPDFService(nil)
		service.Startup(context.Background())

		_, err := service.OpenPDFByPath(pdfPath)
		if err != nil {
			ExitWithError("failed to open PDF", err)
		}
		defer service.ClosePDF()

		pageCount := service.GetPageCount()
		GetLogger().Info("PDF opened", "pages", pageCount)

		if jsonOutput {
			type PageDims struct {
				Page   int     `json:"page"`
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			}
			var pages []PageDims

			for i := 0; i < pageCount; i++ {
				dims, err := service.GetPageDimensions(i)
				if err != nil {
					GetLogger().Warn("failed to get page dimensions", "page", i+1, "error", err)
					continue
				}
				pages = append(pages, PageDims{Page: i + 1, Width: dims.Width, Height: dims.Height})
			}

			data, err := json.MarshalIndent(pages, "", "  ")
			if err != nil {
				ExitWithError("failed to marshal page dimensions to JSON", err)
			}
			fmt.Println(string(data))
		} else {
			fmt.Printf("Page Dimensions:\n")
			for i := 0; i < pageCount; i++ {
				dims, err := service.GetPageDimensions(i)
				if err != nil {
					GetLogger().Warn("failed to get page dimensions", "page", i+1, "error", err)
					continue
				}
				fmt.Printf("  Page %d: %.2f x %.2f pts\n", i+1, dims.Width, dims.Height)
			}
		}
	},
}

var (
	renderPage    int
	renderDPI     float64
	renderOutput  string
	jsonOutput    bool
	thumbnailSize int
)

var pdfRenderCmd = &cobra.Command{
	Use:   "render <pdf-file>",
	Short: "Render a PDF page to PNG",
	Long:  `Render a specific page of a PDF file to a PNG image.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		service := pdf.NewPDFService(nil)
		service.Startup(context.Background())

		_, err := service.OpenPDFByPath(pdfPath)
		if err != nil {
			ExitWithError("failed to open PDF", err)
		}
		defer service.ClosePDF()

		pageCount := service.GetPageCount()
		if renderPage < 1 || renderPage > pageCount {
			ExitWithError(fmt.Sprintf("invalid page number: %d (must be between 1 and %d)", renderPage, pageCount), nil)
		}

		GetLogger().Info("rendering page", "page", renderPage, "dpi", renderDPI)

		pageInfo, err := service.RenderPage(renderPage-1, renderDPI)
		if err != nil {
			ExitWithError("failed to render page", err)
		}

		if renderOutput == "" {
			base := filepath.Base(pdfPath)
			ext := filepath.Ext(base)
			renderOutput = base[:len(base)-len(ext)] + fmt.Sprintf("_page%d.png", renderPage)
		}

		const prefix = "data:image/png;base64,"
		if len(pageInfo.ImageData) < len(prefix) {
			ExitWithError("invalid image data format", nil)
		}

		import64 := pageInfo.ImageData[len(prefix):]

		err = os.WriteFile(renderOutput, []byte(import64), 0644)
		if err != nil {
			ExitWithError("failed to write output file", err)
		}

		GetLogger().Info("page rendered successfully", "output", renderOutput)
		fmt.Printf("Page %d rendered to: %s\n", renderPage, renderOutput)
	},
}

var pdfThumbnailCmd = &cobra.Command{
	Use:   "thumbnail <pdf-file>",
	Short: "Generate a thumbnail of the first page",
	Long:  `Generate a 16:9 thumbnail preview of the first page.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		service := pdf.NewPDFService(nil)
		service.Startup(context.Background())

		GetLogger().Info("generating thumbnail", "width", thumbnailSize)

		thumbnailData, err := service.GenerateThumbnail(pdfPath, thumbnailSize)
		if err != nil {
			ExitWithError("failed to generate thumbnail", err)
		}

		if renderOutput == "" {
			base := filepath.Base(pdfPath)
			ext := filepath.Ext(base)
			renderOutput = base[:len(base)-len(ext)] + "_thumbnail.png"
		}

		const prefix = "data:image/png;base64,"
		if len(thumbnailData) < len(prefix) {
			ExitWithError("invalid thumbnail data format", nil)
		}

		import64 := thumbnailData[len(prefix):]
		err = os.WriteFile(renderOutput, []byte(import64), 0644)
		if err != nil {
			ExitWithError("failed to write thumbnail file", err)
		}

		GetLogger().Info("thumbnail generated successfully", "output", renderOutput)
		fmt.Printf("Thumbnail generated: %s\n", renderOutput)
	},
}

func init() {
	rootCmd.AddCommand(pdfCmd)
	pdfCmd.AddCommand(pdfInfoCmd)
	pdfCmd.AddCommand(pdfPagesCmd)
	pdfCmd.AddCommand(pdfRenderCmd)
	pdfCmd.AddCommand(pdfThumbnailCmd)

	pdfInfoCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")

	pdfPagesCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")

	pdfRenderCmd.Flags().IntVarP(&renderPage, "page", "p", 1, "page number to render")
	pdfRenderCmd.Flags().Float64VarP(&renderDPI, "dpi", "d", 150.0, "DPI for rendering")
	pdfRenderCmd.Flags().StringVarP(&renderOutput, "output", "o", "", "output PNG file (default: <pdf>_page<N>.png)")

	pdfThumbnailCmd.Flags().IntVarP(&thumbnailSize, "width", "w", 400, "maximum width for thumbnail")
	pdfThumbnailCmd.Flags().StringVarP(&renderOutput, "output", "o", "", "output PNG file (default: <pdf>_thumbnail.png)")
}
