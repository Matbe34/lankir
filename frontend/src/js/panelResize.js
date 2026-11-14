// The side panel's width: dragged or stepped on the handle at its inner edge,
// remembered in localStorage (a per-machine view preference, like the theme;
// the backend config has no place for it). The page moves clear of the panel
// every frame of a drag; thumbnails are redrawn sharper once it settles.
import { updatePageRoom } from './pageRoom.js';
import { sharpenThumbnails } from './sidebar.js';

export const PANEL_WIDTH = { min: 180, default: 272, max: 560 };
const MAX_SHARE = 0.45; // of the window
const STEP = 16;
const BIG_STEP = 64;
const STORAGE_KEY = 'lankir.sidePanelWidth';
const SETTLE_MS = 250;

// The page grid's geometry in shell.css: --sp-3 padding either side and
// between columns, and --thumb-min-w as the narrowest column.
const GRID_PAD = 12;
const GRID_GAP = 12;
const THUMB_MIN = 104;
const THUMB_RENDER_MIN = 180;
const THUMB_RENDER_STEP = 20;

/** The widths the panel may take in a window windowWidth wide. */
export function panelRange(windowWidth) {
    const max = Math.min(PANEL_WIDTH.max, Math.floor(windowWidth * MAX_SHARE));
    return { min: PANEL_WIDTH.min, max: Math.max(PANEL_WIDTH.min, max) };
}

export function clampPanelWidth(width, windowWidth) {
    if (!Number.isFinite(width)) width = PANEL_WIDTH.default;
    const { min, max } = panelRange(windowWidth);
    return Math.round(Math.min(max, Math.max(min, width)));
}

/** The width a key on the handle moves to, or null for a key it ignores. */
export function stepPanelWidth(width, key, shiftKey, { min, max }) {
    const step = shiftKey ? BIG_STEP : STEP;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: min, End: max }[key];
    return next === undefined ? null : Math.min(max, Math.max(min, next));
}

/** How many thumbnail columns fit in a panel this wide. */
export function thumbColumns(panelWidth) {
    return Math.max(1, Math.floor((panelWidth - 2 * GRID_PAD + GRID_GAP) / (THUMB_MIN + GRID_GAP)));
}

/** The CSS width to draw thumbnails at, so they stay sharp in their column. */
export function thumbRenderWidth(panelWidth) {
    const columns = thumbColumns(panelWidth);
    const column = (panelWidth - 2 * GRID_PAD - GRID_GAP * (columns - 1)) / columns;
    return Math.max(THUMB_RENDER_MIN, Math.ceil(column / THUMB_RENDER_STEP) * THUMB_RENDER_STEP);
}

export function loadPanelWidth() {
    try {
        const width = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(width) ? width : null;
    } catch {
        return null;
    }
}

export function savePanelWidth(width) {
    try {
        localStorage.setItem(STORAGE_KEY, String(width));
    } catch (err) {
        console.debug('Could not remember the side panel width:', err);
    }
}

let preferred = PANEL_WIDTH.default; // what the user chose; a small window may show less
let applied = 0;
let settleTimer = 0;
let listeners = null;

const $ = (id) => document.getElementById(id);

/** Shows the panel at width (clamped to the window) and moves the page clear of it. */
function apply(width) {
    const workspace = $('workspace');
    const handle = $('panelResizer');
    const range = panelRange(window.innerWidth);
    applied = clampPanelWidth(width, window.innerWidth);
    workspace?.style.setProperty('--panel-w', `${applied}px`);
    workspace?.style.setProperty('--thumb-cols', String(thumbColumns(applied)));
    handle?.setAttribute('aria-valuemin', String(range.min));
    handle?.setAttribute('aria-valuemax', String(range.max));
    handle?.setAttribute('aria-valuenow', String(applied));
    updatePageRoom();
}

function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => sharpenThumbnails(thumbRenderWidth(applied)), SETTLE_MS);
}

/** Sets the width the user chose, remembers it and sharpens thumbnails once it settles. */
function choose(width) {
    apply(width);
    preferred = applied;
    savePanelWidth(preferred);
    settleSoon();
}

function bindDrag(handle, signal) {
    let drag = null;
    let frame = 0;
    const widthAt = (e) => drag.startWidth + e.clientX - drag.startX;
    const end = (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        cancelAnimationFrame(frame);
        frame = 0;
        if (e.type === 'pointerup') drag.width = widthAt(e);
        choose(drag.width);
        drag = null;
        document.documentElement.classList.remove('panel-resizing');
        handle.releasePointerCapture?.(e.pointerId);
    };
    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection, no focus jump
        drag = { pointerId: e.pointerId, startX: e.clientX, startWidth: applied, width: applied };
        handle.setPointerCapture?.(e.pointerId);
        document.documentElement.classList.add('panel-resizing');
    }, { signal });
    handle.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.width = widthAt(e);
        // One layout per frame, however fast the pointer reports.
        frame ||= requestAnimationFrame(() => {
            frame = 0;
            if (drag) apply(drag.width);
        });
    }, { signal });
    handle.addEventListener('pointerup', end, { signal });
    handle.addEventListener('pointercancel', end, { signal });
    handle.addEventListener('lostpointercapture', end, { signal });
}

/** Wires the handle and shows the panel at the remembered width. */
export function initPanelResize() {
    listeners?.abort();
    listeners = new AbortController();
    const { signal } = listeners;
    const handle = $('panelResizer');

    preferred = loadPanelWidth() ?? PANEL_WIDTH.default;
    apply(preferred);
    sharpenThumbnails(thumbRenderWidth(applied));
    window.addEventListener('resize', () => apply(preferred), { signal });
    if (!handle) return;

    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize side panel');
    handle.setAttribute('aria-controls', 'sidePanel');
    handle.tabIndex = 0;
    handle.addEventListener('keydown', (e) => {
        const next = stepPanelWidth(applied, e.key, e.shiftKey, panelRange(window.innerWidth));
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation(); // Home, End and the arrows also turn pages
        choose(next);
    }, { signal });
    handle.addEventListener('dblclick', () => choose(PANEL_WIDTH.default), { signal });
    bindDrag(handle, signal);
}
