import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';

// pdf_viewer.mjs reads globalThis.pdfjsLib while it is evaluated, so it is
// only imported (dynamically) after this assignment.
globalThis.pdfjsLib = pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const { AnnotationEditorType, AnnotationEditorParamsType, AnnotationMode, PasswordResponses, PDFDateString } = pdfjsLib;

let viewerModule = null;
const loadViewerModule = () => (viewerModule ||= import('pdfjs-dist/web/pdf_viewer.mjs'));

// Entering HIGHLIGHT mode throws without a colour list.
export const HIGHLIGHT_COLORS = {
    yellow: '#FFFF98',
    green: '#53FFBC',
    blue: '#80EBFF',
    pink: '#FFCBE6',
    red: '#FF4F5F'
};

const assetUrl = (dir) => new URL(`/pdfjs/${dir}/`, location.href).href;

/**
 * Starts loading a PDF; destroy the returned task to release it. password is
 * tried first; onPassword runs when it is missing or wrong.
 */
export function loadDocument(url, onPassword, password) {
    const task = pdfjsLib.getDocument({
        url,
        password: password ?? undefined,
        cMapUrl: assetUrl('cmaps'),
        standardFontDataUrl: assetUrl('standard_fonts'),
        wasmUrl: assetUrl('wasm'),
        iccUrl: assetUrl('iccs'),
        // The page CSP has no 'unsafe-eval'.
        isEvalSupported: false
    });
    if (onPassword) task.onPassword = onPassword;
    return task;
}

/** Creates a pdf.js viewer in a new container appended to host. */
export async function createViewer(host) {
    const { EventBus, PDFViewer, PDFLinkService, PDFFindController } = await loadViewerModule();
    const container = document.createElement('div');
    container.className = 'pdf-view';
    container.tabIndex = 0;
    const viewer = document.createElement('div');
    viewer.className = 'pdfViewer';
    container.append(viewer);
    host.append(container);

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const pdfViewer = new PDFViewer({
        container,
        viewer,
        eventBus,
        linkService,
        findController,
        // No abortSignal: pdf.js ties the text layers' document-wide listeners,
        // shared by all viewers, to the first one's signal. setDocument(null)
        // and removing the container tear a viewer down.

        // NONE (not DISABLE) creates the annotation editor UI manager.
        annotationEditorMode: AnnotationEditorType.NONE,
        annotationEditorHighlightColors: Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => `${name}=${hex}`).join(',')
    });
    linkService.setViewer(pdfViewer);
    keepPageGutter(pdfViewer, container);
    return { container, eventBus, linkService, findController, pdfViewer };
}

/**
 * pdf.js scrolls a page it goes to (page field, arrows, thumbnails, Home/End)
 * flush with the top of the view. This leaves --page-gutter of canvas above
 * it instead, as above the first page, so the page never touches the header
 * and the markup tools float over canvas and margin, not text.
 */
export function keepPageGutter(pdfViewer, container) {
    const settle = () => {
        const div = pdfViewer.getPageView?.(pdfViewer.currentPageNumber - 1)?.div;
        if (!div) return;
        const top = div.getBoundingClientRect().top + div.clientTop - container.getBoundingClientRect().top;
        const gutter = parseFloat(getComputedStyle(container).getPropertyValue('--page-gutter')) || 0;
        if (Math.abs(top) < 1) container.scrollTop -= gutter;
    };
    const page = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pdfViewer), 'currentPageNumber');
    if (page?.set) {
        Object.defineProperty(pdfViewer, 'currentPageNumber', {
            configurable: true,
            get: () => page.get.call(pdfViewer),
            set: (value) => {
                page.set.call(pdfViewer, value);
                settle();
            }
        });
    }
    const scrollPageIntoView = pdfViewer.scrollPageIntoView;
    if (scrollPageIntoView) {
        // Without a destination it goes to the page's top (links, outline items).
        pdfViewer.scrollPageIntoView = (params) => {
            scrollPageIntoView.call(pdfViewer, params);
            if (!params?.destArray) settle();
        };
    }
}

/** Renders a page into a new canvas that is cssWidth pixels wide. */
export async function renderPageCanvas(pdfPage, cssWidth) {
    const base = pdfPage.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: (cssWidth / base.width) * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    await pdfPage.render({ canvas, viewport }).promise;
    return canvas;
}
