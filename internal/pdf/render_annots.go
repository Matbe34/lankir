// Package pdf provides PDF rendering and processing functionality.
// This file uses CGO to directly call MuPDF's C API for rendering annotations.
//
//go:build cgo
// +build cgo

package pdf

/*
#cgo CFLAGS: -I${SRCDIR}/../../go-fitz-include
#cgo linux,amd64 LDFLAGS: -L${SRCDIR}/../../go-fitz-libs -lmupdf_linux_amd64 -lmupdfthird_linux_amd64 -lm
#include <mupdf/fitz.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>

static int mupdf_warnings_suppressed = 0;
static int saved_stderr = -1;

// suppress_mupdf_warnings redirects stderr to /dev/null to silence MuPDF warnings
void suppress_mupdf_warnings() {
	if (mupdf_warnings_suppressed) return;

	// Save original stderr
	saved_stderr = dup(STDERR_FILENO);

	// Redirect stderr to /dev/null
	int devnull = open("/dev/null", O_WRONLY);
	if (devnull != -1) {
		dup2(devnull, STDERR_FILENO);
		close(devnull);
		mupdf_warnings_suppressed = 1;
	}
}

// restore_mupdf_warnings restores stderr to show MuPDF warnings
void restore_mupdf_warnings() {
	if (!mupdf_warnings_suppressed || saved_stderr == -1) return;

	// Restore original stderr
	dup2(saved_stderr, STDERR_FILENO);
	close(saved_stderr);
	saved_stderr = -1;
	mupdf_warnings_suppressed = 0;
}

// RenderResult contains the result of rendering
typedef struct {
	unsigned char *data;
	int width;
	int height;
	int stride;
	int n;  // number of components (3 for RGB, 4 for RGBA)
	int success;
	char error_msg[256];
} RenderResult;

// render_page_with_annots_safe renders a page with annotations using its own context
// Returns NULL on error, caller must free the result
RenderResult* render_page_with_annots_safe(const char *filename, int page_num, float zoom) {
	fz_context *ctx = NULL;
	fz_document *doc = NULL;
	fz_page *page = NULL;
	fz_pixmap *pix = NULL;
	fz_device *dev = NULL;
	RenderResult *result = NULL;

	// Allocate result structure
	result = (RenderResult*)malloc(sizeof(RenderResult));
	if (!result) {
		return NULL;
	}
	memset(result, 0, sizeof(RenderResult));

	// Create our own context with proper exception handling
	ctx = fz_new_context(NULL, NULL, FZ_STORE_DEFAULT);
	if (!ctx) {
		snprintf(result->error_msg, sizeof(result->error_msg), "failed to create MuPDF context");
		return result;
	}

	// Register default document handlers
	fz_try(ctx) {
		fz_register_document_handlers(ctx);
	}
	fz_catch(ctx) {
		snprintf(result->error_msg, sizeof(result->error_msg), "failed to register document handlers");
		fz_drop_context(ctx);
		return result;
	}

	fz_var(doc);
	fz_var(page);
	fz_var(pix);
	fz_var(dev);

	fz_try(ctx) {
		// Open the document
		doc = fz_open_document(ctx, filename);
		if (!doc) {
			fz_throw(ctx, FZ_ERROR_ARGUMENT, "failed to open document");
		}

		// Check page number
		int page_count = fz_count_pages(ctx, doc);
		if (page_num < 0 || page_num >= page_count) {
			fz_throw(ctx, FZ_ERROR_ARGUMENT, "page number out of range");
		}

		// Load the page
		page = fz_load_page(ctx, doc, page_num);

		// Get page bounds
		fz_rect bounds = fz_bound_page(ctx, page);

		// Create transformation matrix for zoom
		fz_matrix ctm = fz_scale(zoom / 72.0f, zoom / 72.0f);

		// Transform bounds and convert to integer rect
		bounds = fz_transform_rect(bounds, ctm);
		fz_irect bbox = fz_round_rect(bounds);

		// Create pixmap - RGB colorspace
		pix = fz_new_pixmap_with_bbox(ctx, fz_device_rgb(ctx), bbox, NULL, 0);
		fz_clear_pixmap_with_value(ctx, pix, 0xff);  // White background

		// Create draw device
		dev = fz_new_draw_device(ctx, ctm, pix);

		// Run page content
		fz_run_page(ctx, page, dev, fz_identity, NULL);

		// CRITICAL: Run page annotations and widgets (this renders signatures)
		fz_run_page_annots(ctx, page, dev, fz_identity, NULL);
		fz_run_page_widgets(ctx, page, dev, fz_identity, NULL);

		fz_close_device(ctx, dev);

		// Copy pixmap data to result
		result->width = fz_pixmap_width(ctx, pix);
		result->height = fz_pixmap_height(ctx, pix);
		result->stride = fz_pixmap_stride(ctx, pix);
		result->n = fz_pixmap_components(ctx, pix);

		size_t data_size = result->height * result->stride;
		result->data = (unsigned char*)malloc(data_size);
		if (result->data) {
			memcpy(result->data, fz_pixmap_samples(ctx, pix), data_size);
			result->success = 1;
		} else {
			fz_throw(ctx, FZ_ERROR_GENERIC, "failed to allocate result buffer");
		}
	}
	fz_always(ctx) {
		fz_drop_device(ctx, dev);
		fz_drop_pixmap(ctx, pix);
		fz_drop_page(ctx, page);
		fz_drop_document(ctx, doc);
	}
	fz_catch(ctx) {
		const char *err = fz_caught_message(ctx);
		snprintf(result->error_msg, sizeof(result->error_msg), "%s", err ? err : "unknown error");
		result->success = 0;
	}

	fz_drop_context(ctx);
	return result;
}

// free_render_result frees the render result
void free_render_result(RenderResult *result) {
	if (result) {
		if (result->data) {
			free(result->data);
		}
		free(result);
	}
}
*/
import "C"

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"unsafe"
)

// SuppressMuPDFWarnings redirects MuPDF warnings to /dev/null
func SuppressMuPDFWarnings() {
	C.suppress_mupdf_warnings()
}

// RestoreMuPDFWarnings restores MuPDF warnings output
func RestoreMuPDFWarnings() {
	C.restore_mupdf_warnings()
}

// renderPageWithAnnotations renders a PDF page including all annotations and signature widgets
// This uses a completely separate MuPDF context for safety
func (s *PDFService) renderPageWithAnnotations(pageNum int, dpi float64) (*PageInfo, error) {
	s.mu.RLock()
	filePath := s.currentFile
	totalPages := s.pageCount
	s.mu.RUnlock()

	if filePath == "" {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= totalPages {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, totalPages)
	}

	// Convert filename to C string
	cFilename := C.CString(filePath)
	defer C.free(unsafe.Pointer(cFilename))

	// Call C rendering function
	cResult := C.render_page_with_annots_safe(cFilename, C.int(pageNum), C.float(dpi))
	if cResult == nil {
		return nil, fmt.Errorf("failed to allocate render result")
	}
	defer C.free_render_result(cResult)

	// Check if rendering succeeded
	if cResult.success == 0 {
		errorMsg := C.GoString(&cResult.error_msg[0])
		return nil, fmt.Errorf("annotation rendering failed: %s", errorMsg)
	}

	// Convert C data to Go image
	img := cPixmapToImage(cResult)

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("failed to encode PNG: %w", err)
	}

	// Convert to base64
	base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())

	bounds := img.Bounds()
	return &PageInfo{
		PageNumber: pageNum,
		Width:      bounds.Dx(),
		Height:     bounds.Dy(),
		ImageData:  "data:image/png;base64," + base64Data,
	}, nil
}

// cPixmapToImage converts C pixmap data to Go image
func cPixmapToImage(cResult *C.RenderResult) image.Image {
	w := int(cResult.width)
	h := int(cResult.height)
	n := int(cResult.n)
	stride := int(cResult.stride)

	img := image.NewRGBA(image.Rect(0, 0, w, h))

	// Copy pixel data
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			srcOffset := y*stride + x*n
			dstOffset := y*img.Stride + x*4

			// Access C data safely
			dataPtr := unsafe.Pointer(cResult.data)

			if n == 3 {
				// RGB
				img.Pix[dstOffset+0] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+0)))
				img.Pix[dstOffset+1] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+1)))
				img.Pix[dstOffset+2] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+2)))
				img.Pix[dstOffset+3] = 255
			} else if n == 4 {
				// RGBA
				img.Pix[dstOffset+0] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+0)))
				img.Pix[dstOffset+1] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+1)))
				img.Pix[dstOffset+2] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+2)))
				img.Pix[dstOffset+3] = *(*byte)(unsafe.Pointer(uintptr(dataPtr) + uintptr(srcOffset+3)))
			}
		}
	}

	return img
}

// renderPageStandard is a fallback that uses the standard go-fitz rendering
func (s *PDFService) renderPageStandard(pageNum int, dpi float64) (*PageInfo, error) {
	s.mu.RLock()
	doc := s.doc
	s.mu.RUnlock()

	img, err := doc.ImageDPI(pageNum, dpi)
	if err != nil {
		return nil, fmt.Errorf("failed to render page: %w", err)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("failed to encode PNG: %w", err)
	}

	base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())

	bounds := img.Bounds()
	return &PageInfo{
		PageNumber: pageNum,
		Width:      bounds.Dx(),
		Height:     bounds.Dy(),
		ImageData:  "data:image/png;base64," + base64Data,
	}, nil
}
