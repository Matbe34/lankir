// The side panel (left) and the sign panel (right) float over the canvas.
// A page already 16px clear of them stays exactly where it is. Otherwise it
// moves aside just enough to be 16px clear and, if it is wider than the
// width they leave, is zoomed to fit that width with 24px either side until
// they close. Find and the markup tools float over the page's top; the
// scroll padding keeps find hits clear of them.
import { getActivePDF } from './state.js';

const GAP = 12; // the floats' inset from the canvas edges (--sp-3)
const GUTTER = 16; // the least canvas between the page and a panel or the window (--page-gutter)
const FIT_GUTTER = 24; // around a page zoomed to fit between them (--sp-6)
const $ = (id) => document.getElementById(id);
const shown = (el) => el && !el.classList.contains('hidden') && !el.hidden;

/**
 * Where a page pageWidth wide (as drawn) goes in a view viewWidth wide, with
 * the side panel ending at left and the sign panel reaching right pixels in
 * from the right edge: null when it can stay centred, else the padding to
 * give the pages on each side, how far the page's centre moves (shift) and
 * the zoom factor (at most 1) that fits it between the panels. border is
 * pdf.js' transparent border around the drawn page.
 */
export function pageRoom({ viewWidth, pageWidth, left, right, gutter = GUTTER, border = 0 }) {
    if (!left && !right) return null;
    const bounds = (g) => [left + g, viewWidth - right - g];
    let [lo, hi] = bounds(gutter);
    let scale = 1;
    if (pageWidth > hi - lo) {
        [lo, hi] = bounds(FIT_GUTTER);
        scale = Math.min(1, (hi - lo) / pageWidth);
    }
    const centred = (viewWidth - pageWidth) / 2;
    // As close to the centre as the panels allow; never left of lo.
    const x = Math.max(lo, Math.min(centred, hi - pageWidth));
    const shift = x - centred;
    if (Math.abs(shift) < 1 && scale === 1) return null;
    // A page wider than the room starts at lo and scrolls sideways.
    const pad = x + pageWidth > viewWidth
        ? { left: x - border, right: right ? right + FIT_GUTTER : 0 }
        : { left: Math.max(0, shift * 2), right: Math.max(0, -shift * 2) };
    return { ...pad, shift, scale };
}

const px = (n) => `${Math.max(0, Math.round(n))}px`;
const near = (a, b) => Math.abs(a - b) < 1e-3;

/**
 * Fits the page between the panels for as long as they need it, and gives
 * the zoom back when they close. A zoom the user picks meanwhile is theirs.
 */
function fitToRoom(tab, scale, key, page) {
    const viewer = tab.view.pdfViewer;
    if (!viewer?.pdfDocument) return;
    if (tab.roomFit && !near(viewer.currentScale, tab.roomFit.scale)) tab.roomFit = null;
    const changed = key !== tab.roomKey;
    tab.roomKey = key;
    // pdf.js keeps the point at the view's top-left; keep the page's top
    // where it was instead, so the gutter above it stays the same.
    const zoom = (apply) => {
        const top = page.getBoundingClientRect().top;
        apply();
        tab.view.container.scrollTop += page.getBoundingClientRect().top - top;
    };
    if (near(scale, 1)) {
        const fit = tab.roomFit;
        tab.roomFit = null;
        if (fit) zoom(() => { viewer.currentScaleValue = fit.previous; });
        return;
    }
    if (!changed) return;
    const previous = tab.roomFit ?? { previous: viewer.currentScaleValue, previousScale: viewer.currentScale };
    zoom(() => { viewer.currentScale = previous.previousScale * scale; });
    tab.roomFit = { ...previous, scale: viewer.currentScale };
}

// Layout boxes, not painted ones: a panel sliding in is measured where it
// ends up. The view and the floats share the workspace's origin.
const box = (id) => {
    const el = $(id);
    if (!shown(el)) return null;
    return { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight };
};

/** Recomputes the active tab's room from what is open over its view. */
export function updatePageRoom() {
    const tab = getActivePDF();
    const container = tab?.view?.container;
    const workspace = $('workspace');
    if (!container) {
        workspace?.style.setProperty('--page-shift', '0px');
        workspace?.style.setProperty('--free-right', '0px');
        return;
    }
    const panel = box('sidePanel');
    const dock = box('signPanel');
    const tops = [box('findBar'), box('viewerToolbar')].filter(Boolean).map((r) => r.bottom + GAP);
    const viewWidth = container.clientWidth;
    const floats = { viewWidth, left: panel ? panel.right : 0, right: dock ? viewWidth - dock.left : 0 };

    const page = container.querySelector(`.page[data-page-number="${tab.currentPage}"]`) ?? container.querySelector('.page');
    let room = null;
    if (page) {
        const border = (page.offsetWidth - page.clientWidth) / 2;
        const viewer = tab.view.pdfViewer;
        const fitted = () => Boolean(tab.roomFit && viewer && near(viewer.currentScale, tab.roomFit.scale));
        // While fitted, the page is judged at the zoom it will get back.
        const natural = page.clientWidth * (fitted() ? tab.roomFit.previousScale / viewer.currentScale : 1);
        const fit = pageRoom({ ...floats, pageWidth: natural });
        fitToRoom(tab, fit?.scale ?? 1, fit ? `${floats.left} ${floats.right} ${viewWidth}` : '', page);
        room = pageRoom({ ...floats, pageWidth: page.clientWidth, border, gutter: fitted() ? FIT_GUTTER : GUTTER });
    }

    container.classList.toggle('page-room', Boolean(room));
    container.style.setProperty('--room-left', px(room?.left ?? 0));
    container.style.setProperty('--room-right', px(room?.right ?? 0));
    container.style.setProperty('--room-top', px(Math.max(0, ...tops)));
    workspace?.style.setProperty('--page-shift', `${Math.round(room?.shift ?? 0)}px`);
    workspace?.style.setProperty('--free-right', px(dock ? container.offsetWidth - dock.left + GAP : 0));
}
