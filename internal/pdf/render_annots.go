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

// render_page_with_annots renders a page including annotations
static fz_pixmap* render_page_with_annots(fz_context *ctx, fz_document *doc, int page_num, float zoom) {
	fz_page *page = NULL;
	fz_pixmap *pix = NULL;
	fz_matrix ctm;
	fz_rect bounds;
	fz_irect bbox;
	fz_device *dev = NULL;

	fz_var(page);
	fz_var(pix);
	fz_var(dev);

	fz_try(ctx) {
		// Load the page
		page = fz_load_page(ctx, doc, page_num);

		// Get page bounds
		bounds = fz_bound_page(ctx, page);

		// Create transformation matrix for zoom
		ctm = fz_scale(zoom / 72.0f, zoom / 72.0f);

		// Transform bounds and convert to integer rect
		bounds = fz_transform_rect(bounds, ctm);
		bbox = fz_round_rect(bounds);

		// Create pixmap
		pix = fz_new_pixmap_with_bbox(ctx, fz_device_rgb(ctx), bbox, NULL, 1);
		fz_clear_pixmap_with_value(ctx, pix, 0xff);

		// Create draw device
		dev = fz_new_draw_device(ctx, ctm, pix);

		// Run page content
		fz_run_page(ctx, page, dev, fz_identity, NULL);

		// IMPORTANT: Run page annotations (this renders signature widgets and other annotations)
		fz_run_page_annots(ctx, page, dev, fz_identity, NULL);
		fz_run_page_widgets(ctx, page, dev, fz_identity, NULL);

		fz_close_device(ctx, dev);
	}
	fz_always(ctx) {
		fz_drop_device(ctx, dev);
		fz_drop_page(ctx, page);
	}
	fz_catch(ctx) {
		fz_drop_pixmap(ctx, pix);
		return NULL;
	}

	return pix;
}
*/
import "C"

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"reflect"
	"unsafe"
)

// RenderPageWithAnnotations renders a PDF page including all annotations and signature widgets
// This uses MuPDF's native annotation rendering via CGO
func (s *PDFService) renderPageWithAnnotations(pageNum int, dpi float64) (*PageInfo, error) {
	s.mu.RLock()
	doc := s.doc
	totalPages := s.pageCount
	s.mu.RUnlock()

	if doc == nil {
		return nil, fmt.Errorf("no PDF document is open")
	}

	if pageNum < 0 || pageNum >= totalPages {
		return nil, fmt.Errorf("invalid page number: %d (document has %d pages)", pageNum, totalPages)
	}

	docValue := reflect.ValueOf(doc).Elem()
	ctxField := docValue.FieldByName("ctx")
	docField := docValue.FieldByName("doc")

	if !ctxField.IsValid() || !docField.IsValid() {
		// Fallback to standard rendering if we can't access internal fields
		return s.renderPageStandard(pageNum, dpi)
	}

	ctx := (*C.fz_context)(unsafe.Pointer(ctxField.Pointer()))
	fzDoc := (*C.fz_document)(unsafe.Pointer(docField.Pointer()))

	pix := C.render_page_with_annots(ctx, fzDoc, C.int(pageNum), C.float(dpi))
	if pix == nil {
		return nil, fmt.Errorf("failed to render page with annotations")
	}
	defer C.fz_drop_pixmap(ctx, pix)

	img := pixmapToImage(ctx, pix)

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

// renderPageStandard is a fallback that uses the standard go-fitz rendering
func (s *PDFService) renderPageStandard(pageNum int, dpi float64) (*PageInfo, error) {
	img, err := s.doc.ImageDPI(pageNum, dpi)
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

// pixmapToImage converts a fz_pixmap to a Go image.Image
func pixmapToImage(ctx *C.fz_context, pix *C.fz_pixmap) image.Image {
	w := int(C.fz_pixmap_width(ctx, pix))
	h := int(C.fz_pixmap_height(ctx, pix))
	n := int(C.fz_pixmap_components(ctx, pix))
	stride := int(C.fz_pixmap_stride(ctx, pix))
	samples := C.fz_pixmap_samples(ctx, pix)

	img := image.NewRGBA(image.Rect(0, 0, w, h))

	for y := range h {
		for x := range w {
			offset := y*stride + x*n
			if n == 3 {
				img.Pix[y*img.Stride+x*4+0] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+0)))
				img.Pix[y*img.Stride+x*4+1] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+1)))
				img.Pix[y*img.Stride+x*4+2] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+2)))
				img.Pix[y*img.Stride+x*4+3] = 255
			} else if n == 4 {
				img.Pix[y*img.Stride+x*4+0] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+0)))
				img.Pix[y*img.Stride+x*4+1] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+1)))
				img.Pix[y*img.Stride+x*4+2] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+2)))
				img.Pix[y*img.Stride+x*4+3] = *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(samples)) + uintptr(offset+3)))
			}
		}
	}

	return img
}
