import { getActivePDF } from './state.js';
import { updatePageIndicator, updateZoomDisplay } from './utils.js';
import { AnnotationEditorType } from './viewer.js';

const WHEEL_STEP_PX = 50;
let wheelDelta = 0;

/** The active tab's pdf.js viewer once its document has loaded, else null. */
function activeViewer() {
    const viewer = getActivePDF()?.view?.pdfViewer;
    return viewer?.pdfDocument ? viewer : null;
}

export function zoomIn() {
    activeViewer()?.increaseScale();
}

export function zoomOut() {
    activeViewer()?.decreaseScale();
}

/** Sets a pdf.js scale value: a number as a string ("1.5") or "page-width" / "page-fit". */
export function setZoom(value) {
    const viewer = activeViewer();
    if (viewer) viewer.currentScaleValue = value;
}

/** Applies a percentage typed into the zoom box; anything invalid restores the display. */
export function setZoomFromInput(text) {
    const viewer = activeViewer();
    if (!viewer) return;
    const percent = parseInt(text, 10);
    if (Number.isNaN(percent) || percent < 10 || percent > 2500) {
        updateZoomDisplay(viewer.currentScale);
        return;
    }
    viewer.currentScaleValue = String(percent / 100);
}

/** Jumps to a 1-based page; out-of-range input restores the indicator. */
export function goToPage(text) {
    const viewer = activeViewer();
    if (!viewer) return;
    const page = parseInt(text, 10);
    if (Number.isInteger(page) && page >= 1 && page <= viewer.pagesCount) {
        viewer.currentPageNumber = page;
    } else {
        updatePageIndicator(viewer.currentPageNumber, viewer.pagesCount);
    }
}

export function nextPage() {
    activeViewer()?.nextPage();
}

export function previousPage() {
    activeViewer()?.previousPage();
}

/** Ctrl+wheel zooms around the pointer; touchpad deltas are accumulated into steps. */
export function handleZoomWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const viewer = activeViewer();
    if (!viewer || !viewer.container.contains(e.target)) return;
    e.preventDefault();
    wheelDelta += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_STEP_PX;
    const steps = Math.trunc(wheelDelta / WHEEL_STEP_PX);
    if (steps === 0) return;
    wheelDelta -= steps * WHEEL_STEP_PX;
    viewer.updateScale({ steps: -steps, origin: [e.clientX, e.clientY] });
}

/**
 * Page keys for the viewer. Arrow and Page keys scroll natively while the
 * viewer has focus; these cover page jumps and focus elsewhere. Returns true
 * when the key was handled.
 */
export function handleNavigationKey(e) {
    const viewer = activeViewer();
    if (!viewer || e.altKey || e.metaKey) return false;
    // In an editing mode the arrow keys move the selected annotation.
    const editing = viewer.annotationEditorMode > AnnotationEditorType.NONE;
    const focusInViewer = viewer.container.contains(document.activeElement);
    const scrollsSideways = viewer.container.scrollWidth > viewer.container.clientWidth;
    switch (e.key) {
        case 'Home':
            viewer.currentPageNumber = 1;
            return true;
        case 'End':
            viewer.currentPageNumber = viewer.pagesCount;
            return true;
        case 'PageDown':
            if (focusInViewer) return false;
            viewer.nextPage();
            return true;
        case 'PageUp':
            if (focusInViewer) return false;
            viewer.previousPage();
            return true;
        case 'ArrowRight':
            if (editing || e.ctrlKey || scrollsSideways) return false;
            viewer.nextPage();
            return true;
        case 'ArrowLeft':
            if (editing || e.ctrlKey || scrollsSideways) return false;
            viewer.previousPage();
            return true;
        default:
            return false;
    }
}
