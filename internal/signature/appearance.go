package signature

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// CreateSignatureAppearance configures the signature appearance for visible signatures
// based on the profile settings. It returns a sign.Appearance that can be used with SignData.
func CreateSignatureAppearance(profile *SignatureProfile, cert *Certificate, signingTime time.Time) *sign.Appearance {
	appearance := &sign.Appearance{
		Visible: profile.Visibility == VisibilityVisible,
	}

	if !appearance.Visible {
		return appearance
	}

	// Set position and page (Page is 1-indexed in pdfsign library)
	page := profile.Position.Page
	if page <= 0 {
		page = 1 // Default to first page if not specified
	}
	appearance.Page = uint32(page)

	// PDF coordinates: LowerLeft is the bottom-left corner, UpperRight is top-right
	// Our coordinates from frontend already have Y from bottom
	appearance.LowerLeftX = profile.Position.X
	appearance.LowerLeftY = profile.Position.Y
	appearance.UpperRightX = profile.Position.X + profile.Position.Width
	appearance.UpperRightY = profile.Position.Y + profile.Position.Height

	// Debug output
	fmt.Printf("APPEARANCE RECT: Page=%d LL=(%.2f,%.2f) UR=(%.2f,%.2f)\n",
		appearance.Page, appearance.LowerLeftX, appearance.LowerLeftY,
		appearance.UpperRightX, appearance.UpperRightY)

	// Ensure we have valid rectangle
	if appearance.UpperRightX <= appearance.LowerLeftX {
		appearance.UpperRightX = appearance.LowerLeftX + 200
	}
	if appearance.UpperRightY <= appearance.LowerLeftY {
		appearance.UpperRightY = appearance.LowerLeftY + 80
	}

	// Build the text content based on appearance settings
	var textLines []string

	if profile.Appearance.ShowSignerName {
		signerName := cert.Name
		if signerName == "" {
			signerName = cert.Subject
		}
		textLines = append(textLines, fmt.Sprintf("Signed by: %s", signerName))
	}

	if profile.Appearance.ShowSigningTime {
		timeStr := signingTime.Format("2006-01-02 15:04:05 MST")
		textLines = append(textLines, fmt.Sprintf("Date: %s", timeStr))
	}

	if profile.Appearance.ShowReason && profile.Reason != "" {
		textLines = append(textLines, fmt.Sprintf("Reason: %s", profile.Reason))
	}

	if profile.Appearance.ShowLocation && profile.Location != "" {
		textLines = append(textLines, fmt.Sprintf("Location: %s", profile.Location))
	}

	if profile.Appearance.ShowCertificateInfo {
		if cert.Issuer != "" {
			textLines = append(textLines, fmt.Sprintf("Issuer: %s", cert.Issuer))
		}
		if cert.SerialNumber != "" {
			textLines = append(textLines, fmt.Sprintf("Serial: %s", cert.SerialNumber))
		}
	}

	if profile.Appearance.CustomText != "" {
		textLines = append(textLines, profile.Appearance.CustomText)
	}

	// Generate image with text for appearance
	// pdfsign requires an actual image for visible signatures
	appearance.Image = generateSignatureImage(textLines, profile)
	appearance.ImageAsWatermark = false // Show only the image, not text overlay

	return appearance
}

// generateSignatureImage creates an image for signature appearance
// The image is scaled to match the signature rectangle size
func generateSignatureImage(textLines []string, profile *SignatureProfile) []byte {
	width := int(profile.Position.Width)
	height := int(profile.Position.Height)

	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}

	img := image.NewRGBA(image.Rect(0, 0, width, height))

	// Transparent background
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{0, 0, 0, 0})
		}
	}

	var logoImg image.Image
	if profile.Appearance.ShowLogo && profile.Appearance.LogoPath != "" {
		logoImg = decodeLogoImage(profile.Appearance.LogoPath)
	}

	if len(textLines) == 0 && logoImg == nil {
		var buf bytes.Buffer
		png.Encode(&buf, img)
		return buf.Bytes()
	}

	if logoImg != nil && len(textLines) == 0 {
		drawLogoOnly(img, logoImg)
		var buf bytes.Buffer
		png.Encode(&buf, img)
		return buf.Bytes()
	}

	// Calculate optimal font size based on available height
	margin := 4
	maxWidth := width - (margin * 2)

	// Load scalable font
	ttf, err := opentype.Parse(goregular.TTF)
	if err != nil {
		// Fallback to empty image if font loading fails
		var buf bytes.Buffer
		png.Encode(&buf, img)
		return buf.Bytes()
	}

	// Calculate font size: divide available height by estimated number of wrapped lines
	// Start with a size estimate and adjust
	fontSize := float64(height) / float64(len(textLines)+1)
	if fontSize < 4 {
		fontSize = 4
	}
	if fontSize > 72 {
		fontSize = 72
	}

	// Try different font sizes to find the best fit
	var face font.Face
	var wrappedLines []string

	for attempt := 0; attempt < 10; attempt++ {
		face, err = opentype.NewFace(ttf, &opentype.FaceOptions{
			Size: fontSize,
			DPI:  72,
		})
		if err != nil {
			var buf bytes.Buffer
			png.Encode(&buf, img)
			return buf.Bytes()
		}

		// Word wrap all text lines to fit width
		wrappedLines = nil
		for _, line := range textLines {
			words := splitIntoWords(line)
			currentLine := ""

			for _, word := range words {
				testLine := currentLine
				if testLine != "" {
					testLine += " "
				}
				testLine += word

				d := &font.Drawer{Face: face}
				lineWidth := d.MeasureString(testLine).Ceil()

				if lineWidth <= maxWidth {
					currentLine = testLine
				} else {
					if currentLine != "" {
						wrappedLines = append(wrappedLines, currentLine)
					}
					currentLine = word
				}
			}
			if currentLine != "" {
				wrappedLines = append(wrappedLines, currentLine)
			}
		}

		// Check if all lines fit
		totalHeight := len(wrappedLines)*int(fontSize*1.2) + margin*2
		if totalHeight <= height || fontSize <= 4 {
			break
		}

		// Reduce font size and try again
		face.Close()
		fontSize *= 0.8
	}

	if len(wrappedLines) == 0 {
		face.Close()
		var buf bytes.Buffer
		png.Encode(&buf, img)
		return buf.Bytes()
	}

	// Handle logo and text layout
	if logoImg != nil {
		if profile.Appearance.LogoPosition == "top" {
			// Draw logo on top, text below
			logoHeight := 60
			if logoHeight > height/3 {
				logoHeight = height / 3
			}
			drawResizedLogo(img, logoImg, width/2, margin+logoHeight/2, logoHeight)

			// Adjust text starting position
			col := color.Black
			d := &font.Drawer{
				Dst:  img,
				Src:  image.NewUniform(col),
				Face: face,
			}

			lineSpacing := int(fontSize * 1.2)
			startY := margin + logoHeight + margin + int(fontSize)

			for i, line := range wrappedLines {
				yPos := startY + i*lineSpacing
				if yPos > height-margin {
					break
				}
				d.Dot.X = fixed.I(margin)
				d.Dot.Y = fixed.I(yPos)
				d.DrawString(line)
			}
		} else {
			// Draw logo on left, text on right
			logoWidth := 60
			if logoWidth > width/3 {
				logoWidth = width / 3
			}
			drawResizedLogo(img, logoImg, margin+logoWidth/2, height/2, logoWidth)

			// Adjust text position to right of logo
			col := color.Black
			d := &font.Drawer{
				Dst:  img,
				Src:  image.NewUniform(col),
				Face: face,
			}

			lineSpacing := int(fontSize * 1.2)
			startY := margin + int(fontSize)
			textStartX := margin + logoWidth + margin

			for i, line := range wrappedLines {
				yPos := startY + i*lineSpacing
				if yPos > height-margin {
					break
				}
				d.Dot.X = fixed.I(textStartX)
				d.Dot.Y = fixed.I(yPos)
				d.DrawString(line)
			}
		}
	} else {
		// Draw text only
		col := color.Black
		d := &font.Drawer{
			Dst:  img,
			Src:  image.NewUniform(col),
			Face: face,
		}

		lineSpacing := int(fontSize * 1.2)
		startY := margin + int(fontSize)

		for i, line := range wrappedLines {
			yPos := startY + i*lineSpacing
			if yPos > height-margin {
				break
			}
			d.Dot.X = fixed.I(margin)
			d.Dot.Y = fixed.I(yPos)
			d.DrawString(line)
		}
	}

	face.Close()

	var buf bytes.Buffer
	png.Encode(&buf, img)

	return buf.Bytes()
}

// decodeLogoImage decodes a base64 data URL to an image
func decodeLogoImage(dataURL string) image.Image {
	if !strings.HasPrefix(dataURL, "data:image/") {
		return nil
	}

	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil
	}

	data, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}

	return img
}

// drawLogoOnly draws just the logo centered in the image
func drawLogoOnly(dst *image.RGBA, logo image.Image) {
	bounds := dst.Bounds()
	maxSize := 60
	if bounds.Dx() < maxSize {
		maxSize = bounds.Dx()
	}
	if bounds.Dy() < maxSize {
		maxSize = bounds.Dy()
	}

	drawResizedLogo(dst, logo, bounds.Dx()/2, bounds.Dy()/2, maxSize)
}

// drawResizedLogo draws a logo at the specified position with max size
func drawResizedLogo(dst *image.RGBA, logo image.Image, centerX, centerY, maxSize int) {
	logoBounds := logo.Bounds()
	logoW := logoBounds.Dx()
	logoH := logoBounds.Dy()

	scale := float64(maxSize) / float64(logoW)
	if float64(logoH) > float64(logoW) {
		scale = float64(maxSize) / float64(logoH)
	}

	newW := int(float64(logoW) * scale)
	newH := int(float64(logoH) * scale)

	scaled := image.NewRGBA(image.Rect(0, 0, newW, newH))
	for y := 0; y < newH; y++ {
		for x := 0; x < newW; x++ {
			srcX := int(float64(x) / scale)
			srcY := int(float64(y) / scale)
			scaled.Set(x, y, logo.At(srcX+logoBounds.Min.X, srcY+logoBounds.Min.Y))
		}
	}

	startX := centerX - newW/2
	startY := centerY - newH/2

	draw.Draw(dst, image.Rect(startX, startY, startX+newW, startY+newH), scaled, image.Point{0, 0}, draw.Over)
} // splitIntoWords splits text into words preserving punctuation
func splitIntoWords(text string) []string {
	var words []string
	current := ""

	for _, r := range text {
		if r == ' ' {
			if current != "" {
				words = append(words, current)
				current = ""
			}
		} else {
			current += string(r)
		}
	}

	if current != "" {
		words = append(words, current)
	}

	return words
}

// calculatePageNumber converts the profile page setting to actual page number
// 0 = last page, -1 = first page, positive = specific page
// For pdfsign library: 0 means use as-is (will be set dynamically), positive = specific page
func calculatePageNumber(page int) int {
	if page == -1 {
		return 1 // First page
	}
	if page <= 0 {
		return 0 // Will be set to last page or dynamically
	}
	return page
}
