package signature

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"github.com/ferran/pdf_app/internal/signature/types"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	DefaultSignatureWidth  = 200
	DefaultSignatureHeight = 80
)

// CreateSignatureAppearance configures the signature appearance for visible signatures
// based on the profile settings. It returns a sign.Appearance that can be used with SignData.
func CreateSignatureAppearance(profile *SignatureProfile, cert *types.Certificate, signingTime time.Time) *sign.Appearance {
	appearance := &sign.Appearance{
		Visible: profile.Visibility == VisibilityVisible,
	}

	if !appearance.Visible {
		return appearance
	}

	page := profile.Position.Page
	if page <= 0 {
		page = 1
	}
	appearance.Page = uint32(page)

	appearance.LowerLeftX = profile.Position.X
	appearance.LowerLeftY = profile.Position.Y
	appearance.UpperRightX = profile.Position.X + profile.Position.Width
	appearance.UpperRightY = profile.Position.Y + profile.Position.Height

	if appearance.UpperRightX <= appearance.LowerLeftX {
		appearance.UpperRightX = appearance.LowerLeftX + DefaultSignatureWidth
	}
	if appearance.UpperRightY <= appearance.LowerLeftY {
		appearance.UpperRightY = appearance.LowerLeftY + DefaultSignatureHeight
	}

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

	if profile.Appearance.ShowLocation {
		location, err := getLocationString()
		if err == nil && location != "" {
			textLines = append(textLines, fmt.Sprintf("Location: %s", location))
		}
	}

	if profile.Appearance.CustomText != "" {
		textLines = append(textLines, profile.Appearance.CustomText)
	}

	appearance.Image = generateSignatureImage(textLines, profile)
	appearance.ImageAsWatermark = false

	return appearance
}

// generateSignatureImage creates an image for signature appearance
// Renders at higher resolution (3x) for better quality at all sizes
func generateSignatureImage(textLines []string, profile *SignatureProfile) []byte {
	generator := NewSignatureImageGenerator(profile, textLines)
	return generator.Generate()
}

// SignatureImageGenerator handles the creation of the signature image
type SignatureImageGenerator struct {
	profile   *SignatureProfile
	textLines []string
	scale     float64
	width     int
	height    int
	margin    int
	logoImg   image.Image
}

// NewSignatureImageGenerator creates a new generator instance
func NewSignatureImageGenerator(profile *SignatureProfile, textLines []string) *SignatureImageGenerator {
	baseWidth := int(profile.Position.Width)
	baseHeight := int(profile.Position.Height)

	if baseWidth < 1 {
		baseWidth = 1
	}
	if baseHeight < 1 {
		baseHeight = 1
	}

	scale := 4.0

	width := int(float64(baseWidth) * scale)
	height := int(float64(baseHeight) * scale)

	margin := int(2.0 * scale) // Default: 2pt margin
	if baseHeight < 30 || baseWidth < 60 {
		margin = int(1.0 * scale)
	}
	maxMargin := int(5.0 * scale)
	if margin > maxMargin {
		margin = maxMargin
	}

	var logoImg image.Image
	if profile.Appearance.ShowLogo && profile.Appearance.LogoPath != "" {
		logoImg = decodeLogoImage(profile.Appearance.LogoPath)
	}

	return &SignatureImageGenerator{
		profile:   profile,
		textLines: textLines,
		scale:     scale,
		width:     width,
		height:    height,
		margin:    margin,
		logoImg:   logoImg,
	}
}

// Generate creates the final signature image
func (g *SignatureImageGenerator) Generate() []byte {
	img := image.NewRGBA(image.Rect(0, 0, g.width, g.height))

	for y := range g.height {
		for x := range g.width {
			img.Set(x, y, color.RGBA{0, 0, 0, 0})
		}
	}

	if len(g.textLines) == 0 && g.logoImg == nil {
		return g.encodeImage(img)
	}

	if g.logoImg != nil && len(g.textLines) == 0 {
		g.drawLogoOnly(img)
		return g.encodeImage(img)
	}

	ttf, err := opentype.Parse(goregular.TTF)
	if err != nil {
		return g.encodeImage(img)
	}

	g.drawContent(img, ttf)

	return g.encodeImage(img)
}

// encodeImage encodes the image to PNG bytes
func (g *SignatureImageGenerator) encodeImage(img image.Image) []byte {
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

// drawLogoOnly draws just the logo centered in the image
func (g *SignatureImageGenerator) drawLogoOnly(dst *image.RGBA) {
	maxSize := min(g.width*2/3, g.height*2/3)
	drawResizedLogo(dst, g.logoImg, g.width/2, g.height/2, maxSize)
}

// drawContent calculates layout and draws both logo and text
func (g *SignatureImageGenerator) drawContent(img *image.RGBA, ttf *opentype.Font) {
	textWidth := g.width - (g.margin * 2)
	availableHeight := g.height - (g.margin * 2)

	logoSize := 0
	logoX, logoY := 0, 0

	if g.logoImg != nil {
		if g.profile.Appearance.LogoPosition == "top" {
			logoSize = max(int(float64(g.height)*0.2), 10)

			logoX = g.width / 2
			logoY = g.margin + logoSize/2
			availableHeight -= (logoSize + g.margin)
		} else {
			logoSize = max(int(float64(g.width)*0.2), 10)

			logoX = g.margin + logoSize/2
			logoY = g.height / 2
			textWidth -= (logoSize + g.margin)
		}
	}

	fontSize, wrappedLines, face := g.calculateOptimalFontSize(ttf, textWidth, availableHeight)
	defer func() {
		if face != nil {
			face.Close()
		}
	}()

	if len(wrappedLines) == 0 {
		if g.logoImg != nil {
			drawResizedLogo(img, g.logoImg, logoX, logoY, logoSize)
		}
		return
	}

	if g.logoImg != nil {
		drawResizedLogo(img, g.logoImg, logoX, logoY, logoSize)
	}

	g.drawTextLines(img, face, wrappedLines, fontSize, logoSize)
}

// calculateOptimalFontSize finds the best font size to fit text
func (g *SignatureImageGenerator) calculateOptimalFontSize(ttf *opentype.Font, maxWidth, maxHeight int) (float64, []string, font.Face) {
	fontSize := (float64(maxHeight) / float64(len(g.textLines)+1)) * 0.8

	minSize := 1 * g.scale // Minimum readable size
	maxSize := 72.0 * g.scale

	if fontSize < minSize {
		fontSize = minSize
	}
	if fontSize > maxSize {
		fontSize = maxSize
	}

	var face font.Face
	var wrappedLines []string
	var err error

	defer func() {
		if err != nil && face != nil {
			face.Close()
		}
	}()

	for range 20 {
		// Close previous face before creating new one
		if face != nil {
			face.Close()
			face = nil
		}

		face, err = opentype.NewFace(ttf, &opentype.FaceOptions{
			Size: fontSize,
			DPI:  72,
		})
		if err != nil {
			return 0, nil, nil
		}

		wrappedLines = g.wrapLines(g.textLines, face, maxWidth)

		lineSpacing := int(fontSize * 1.2)
		requiredHeight := int(fontSize) + (len(wrappedLines)-1)*lineSpacing

		if requiredHeight <= maxHeight || fontSize <= minSize {
			return fontSize, wrappedLines, face
		}

		fontSize *= 0.9
	}

	if face != nil {
		face.Close()
	}

	face, _ = opentype.NewFace(ttf, &opentype.FaceOptions{
		Size: minSize,
		DPI:  72,
	})
	wrappedLines = g.wrapLines(g.textLines, face, maxWidth)
	return minSize, wrappedLines, face
}

// wrapLines wraps multiple lines of text
func (g *SignatureImageGenerator) wrapLines(lines []string, face font.Face, maxWidth int) []string {
	var result []string
	for _, line := range lines {
		result = append(result, g.wrapText(line, face, maxWidth)...)
	}
	return result
}

// wrapText wraps a single line of text
func (g *SignatureImageGenerator) wrapText(text string, face font.Face, maxWidth int) []string {
	words := splitIntoWords(text)
	var lines []string
	currentLine := ""
	d := &font.Drawer{Face: face}

	for _, word := range words {
		testLine := currentLine
		if testLine != "" {
			testLine += " "
		}
		testLine += word

		if d.MeasureString(testLine).Ceil() <= maxWidth {
			currentLine = testLine
		} else {
			if currentLine != "" {
				lines = append(lines, currentLine)
			}
			currentLine = word
		}
	}
	if currentLine != "" {
		lines = append(lines, currentLine)
	}
	return lines
}

// drawTextLines draws the lines of text onto the image
func (g *SignatureImageGenerator) drawTextLines(img *image.RGBA, face font.Face, lines []string, fontSize float64, logoSize int) {
	col := color.Black
	d := &font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(col),
		Face: face,
	}

	lineSpacing := int(fontSize * 1.2)

	startX := g.margin
	startY := g.margin + int(fontSize)

	if g.logoImg != nil {
		if g.profile.Appearance.LogoPosition == "top" {
			startY += logoSize + g.margin
		} else {
			startX += logoSize + g.margin
		}
	}

	for i, line := range lines {
		yPos := startY + i*lineSpacing
		if yPos > g.height-g.margin {
			break
		}
		d.Dot.X = fixed.I(startX)
		d.Dot.Y = fixed.I(yPos)
		d.DrawString(line)
	}
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
	for y := range newH {
		for x := range newW {
			srcX := int(float64(x) / scale)
			srcY := int(float64(y) / scale)
			scaled.Set(x, y, logo.At(srcX+logoBounds.Min.X, srcY+logoBounds.Min.Y))
		}
	}

	startX := centerX - newW/2
	startY := centerY - newH/2

	draw.Draw(dst, image.Rect(startX, startY, startX+newW, startY+newH), scaled, image.Point{0, 0}, draw.Over)
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

// splitIntoWords splits text into words preserving punctuation
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

var (
	locationCache      string
	locationCacheTime  time.Time
	locationCacheMutex sync.RWMutex
	locationCacheTTL   = 1 * time.Hour
)

// getLocationString retrieves the location string with caching and rate limiting
func getLocationString() (string, error) {
	locationCacheMutex.RLock()
	if time.Since(locationCacheTime) < locationCacheTTL && locationCache != "" {
		cached := locationCache
		locationCacheMutex.RUnlock()
		return cached, nil
	}
	locationCacheMutex.RUnlock()

	locationCacheMutex.Lock()
	defer locationCacheMutex.Unlock()

	if time.Since(locationCacheTime) < locationCacheTTL && locationCache != "" {
		return locationCache, nil
	}

	location, err := fetchLocationFromAPI()
	if err != nil {
		if locationCache != "" {
			return locationCache, nil
		}
		return "", err
	}

	locationCache = location
	locationCacheTime = time.Now()

	return location, nil
}

// fetchLocationFromAPI performs the actual HTTP request to ipinfo.io
func fetchLocationFromAPI() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	endpoint := "https://ipinfo.io/json"
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("failed to get location: status %d", resp.StatusCode)
	}

	var result struct {
		City    string `json:"city"`
		Region  string `json:"region"`
		Country string `json:"country"`
	}

	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return "", err
	}

	parts := []string{}
	if result.City != "" {
		parts = append(parts, result.City)
	}
	if result.Region != "" {
		parts = append(parts, result.Region)
	}
	if result.Country != "" {
		parts = append(parts, result.Country)
	}

	if len(parts) == 0 {
		return "", nil
	}

	return strings.Join(parts, ", "), nil
}
