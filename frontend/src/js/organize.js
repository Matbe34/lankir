// Organize pages: a full-canvas grid of the active tab's pages over its
// reading view, to select, rotate, reorder, duplicate, extract, insert and
// delete them (pageOps.js does the work). It is a state of each tab, like its
// scroll position: a tab left organizing is still organizing when it comes
// back, and the others stay in reading.
import { state, getActivePDF } from './state.js';
import { renderPageCanvas } from './viewer.js';
import { iconSvg } from './icons.js';
import { showToast, placeToasts } from './toast.js';
import { saveTab } from './documents.js';
import { bindMenu, openMenuAt, closeOpenMenu, isMenuOpen } from './menus.js';
import { setMarkupShown } from './annotationToolbar.js';
import { closeFindBar } from './findBar.js';
import { closeSignPanel } from './signature.js';
import { insertFromFiles } from './documentTools.js';
import {
    nextSelection, moveOrder, shouldUndoPageOp, shouldRedoPageOp,
    rotatePages, deletePages, duplicatePages, movePages, insertBlankPage, extractPages, undoPageOp, redoPageOp
} from './pageOps.js';

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A page's box in the grid is A4 portrait at the thumbnail width; other
// shapes fit inside it, standing on its bottom edge.
const BOX_RATIO = 1.414;
const SIZE = { min: 120, max: 320, step: 20 };
const DRAG_START = 5; // px the pointer moves before a press becomes a drag
const EDGE = 56; // px from the grid's top or bottom where a drag scrolls it
let thumbSize = 200;
let sizeChosen = false; // once the user picks a size, it stays

const GRID_SIDES = 64; // .organize-grid's side padding (--sp-8 each)
const GRID_GAP = 24; // its column gap (--sp-6)
const DEFAULT_COLUMNS = 5;

/** The thumbnail size, up to 200, at which about five columns fit a view width px wide. */
export function defaultThumbSize(width) {
    if (!width) return 200;
    const fit = (width - GRID_SIDES - GRID_GAP * (DEFAULT_COLUMNS - 1)) / DEFAULT_COLUMNS;
    return Math.max(SIZE.min, Math.min(200, Math.floor(fit / SIZE.step) * SIZE.step));
}
let changesToast = null; // { tab, dismiss }: Done's toast, until the changes are saved or undone

/** "3 changes not saved". */
export const changesLabel = (n) => `${plural(n, 'change')} not saved`;

/** What dropping count pages at gap (see moveOrder) does, in words. */
export const dragLabel = (count, gap) => `Drop to move ${plural(count, 'page')} ${gap === 0 ? 'to the start' : `after page ${gap}`}`;

/** Signature fields per page (1-based) from pdf.js' getFieldObjects() (a Map of name to widgets). */
export function signatureCounts(fields) {
    const counts = new Map();
    for (const widgets of fields instanceof Map ? fields.values() : Object.values(fields ?? {})) {
        for (const w of widgets) {
            if (w.type === 'signature' && Number.isInteger(w.page)) counts.set(w.page + 1, (counts.get(w.page + 1) ?? 0) + 1);
        }
    }
    return counts;
}

const overlaps = (a, b) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

const BAND_MIN = 4; // how far into a page the band must reach to take it

/** The pages (1-based) a rubber band reaches into, given each page's own rect (not its cell). */
export function bandHits(rects, band) {
    const into = (r) => Math.min(r.right, band.right) - Math.max(r.left, band.left) >= BAND_MIN
        && Math.min(r.bottom, band.bottom) - Math.max(r.top, band.top) >= BAND_MIN;
    return rects.flatMap((r, i) => (into(r) ? [i + 1] : []));
}

/**
 * Where pages dragged to (x, y) land in a grid of cells (rects in page
 * order, rows top to bottom): the gap (moveOrder's, 0 = the front) and the
 * insertion line, a vertical one between the cells of the nearest row.
 */
export function dropSlot(rects, x, y) {
    const rows = [];
    rects.forEach((r, i) => {
        const row = rows.at(-1);
        if (row && Math.abs(rects[row[0]].top - r.top) < 1) row.push(i);
        else rows.push([i]);
    });
    const distance = (row) => {
        const { top, bottom } = rects[row[0]];
        return y < top ? top - y : y > bottom ? y - bottom : 0;
    };
    const row = rows.reduce((best, r) => (distance(r) < distance(best) ? r : best));
    const first = rects[row[0]];
    // Half the space between columns; a lone cell uses its row gap's.
    const half = row.length > 1 ? (rects[row[1]].left - first.right) / 2
        : rows.length > 1 ? (rects[rows[1][0]].top - first.bottom) / 2 : 0;
    const at = row.find((i) => x < (rects[i].left + rects[i].right) / 2);
    const line = { top: first.top, bottom: first.bottom };
    if (at === undefined) return { gap: row.at(-1) + 1, line: { x: rects[row.at(-1)].right + half, ...line } };
    const before = row.indexOf(at) > 0 ? rects[at - 1].right : rects[at].left - 2 * half;
    return { gap: at, line: { x: (before + rects[at].left) / 2, ...line } };
}

// ---------- The view ----------

const selectedPages = (tab) => [...tab.selection].sort((a, b) => a - b);
const isDialogOpen = () => document.querySelector('.modal-overlay:not(.hidden), #signPanel:not(.hidden)') !== null;
const isTyping = () => {
    const el = document.activeElement;
    return Boolean(el && (el.matches?.('input:not([type="range"]), textarea, select') || el.isContentEditable));
};
// Enter and the arrows walk the grid only from the view itself: a focused button or the size slider keeps them.
const onGrid = () => [document.body, $('organizeView'), null].includes(document.activeElement);

/** Organizes tab's pages: the grid takes the canvas until Done. */
export function enterOrganize(tab = getActivePDF()) {
    if (!tab?.pdfDocument || tab.organizing) return;
    setMarkupShown(false);
    closeFindBar(tab);
    closeSignPanel();
    tab.organizing = true;
    tab.organizeChanged = false;
    tab.selection = new Set();
    tab.selectionAnchor = null;
    syncOrganize(tab);
    $('organizeView')?.focus({ preventScroll: true });
}

/** Back to reading tab on its current page; a toast sums up changes not saved. */
export function exitOrganize(tab = getActivePDF()) {
    if (!tab?.organizing) return;
    cancelDrag();
    closeOpenMenu();
    tab.organizing = false;
    if (state.activeTabId === tab.id) syncOrganize(tab);
    const viewer = tab.view?.pdfViewer;
    if (viewer) {
        viewer.update?.();
        viewer.currentPageNumber = tab.currentPage;
    }
    tab.view?.container?.focus?.({ preventScroll: true });
    if (tab.organizeChanged && tab.modified) {
        const n = tab.undoSteps;
        changesToast?.dismiss();
        const { dismiss } = showToast(n > 0 ? plural(n, 'unsaved change') : 'Unsaved changes', {
            icon: 'layout-grid',
            timeout: 8000,
            actions: [
                ...(n > 0 ? [{ label: 'Undo', run: () => undoPageOp(tab, n) }] : []),
                { label: 'Save', keys: 'Ctrl S', run: () => saveTab(tab.id) }
            ]
        });
        changesToast = { tab, dismiss };
    }
}

/** Enters or leaves organizing the active tab. */
export function toggleOrganize() {
    const tab = getActivePDF();
    if (tab?.organizing) exitOrganize(tab);
    else enterOrganize(tab);
}

/** Leaves organizing the active tab, if it is, before another tool takes the canvas. */
export function leaveOrganize() {
    const tab = getActivePDF();
    if (tab?.organizing) exitOrganize(tab);
}

/**
 * Shows tab (the active one, or null on the start page) as it is: its grid
 * when organizing, else its reading view. documents.js calls this whenever
 * the active tab changes or reloads.
 */
export function syncOrganize(tab) {
    const view = $('organizeView');
    if (!view) return;
    // A gesture or the page menu belongs to the tab it started on.
    if (tab !== shownTab) {
        shownTab = tab;
        endGestures();
        for (const id of ['organizeMenu', 'organizeInsertMenu']) {
            if (!$(id)?.classList.contains('hidden')) closeOpenMenu();
        }
    }
    if (changesToast && !changesToast.tab.modified) {
        changesToast.dismiss();
        changesToast = null;
    }
    const on = Boolean(tab?.organizing && tab.pdfDocument);
    $('workspace')?.classList.toggle('is-organizing', on);
    view.classList.toggle('hidden', !on);
    $('organizeBar')?.classList.toggle('hidden', !on);
    $('organizePill')?.classList.toggle('hidden', !on);
    placeToasts();
    if (!on) {
        view.replaceChildren();
        return;
    }
    if (tab.organizeGrid?.doc !== tab.pdfDocument) buildGrid(tab);
    if (view.firstChild !== tab.organizeGrid.el) {
        view.replaceChildren(tab.organizeGrid.el);
        view.scrollTop = tab.organizeGrid.scrollTop ?? 0;
    }
    setThumbSize(sizeChosen ? thumbSize : defaultThumbSize(view.clientWidth));
    refreshSelection(tab);
    refreshBar(tab);
}

/** Drops a closed tab's grid. */
export function disposeOrganize(tab) {
    if ([press, band, drag].some((g) => g?.tab === tab)) endGestures();
    if (changesToast?.tab === tab) {
        changesToast.dismiss();
        changesToast = null;
    }
    tab.organizeGrid?.observer.disconnect();
    tab.organizeGrid = null;
}

function buildGrid(tab) {
    const view = $('organizeView');
    const old = tab.organizeGrid;
    // The tiles in view keep their old drawings until the new ones are in, so
    // the grid doesn't flash blank after each change.
    const shown = old ? visibleTiles(old.el) : [];
    old?.observer.disconnect();

    const el = document.createElement('div');
    el.className = 'organize-grid';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-multiselectable', 'true');
    el.setAttribute('aria-label', 'Pages');
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            drawTile(tab, entry.target);
        }
    }, { root: view, rootMargin: '400px 0px' });

    for (let n = 1; n <= tab.totalPages; n++) {
        const tile = document.createElement('div');
        tile.className = 'organize-tile';
        tile.dataset.page = String(n);
        tile.setAttribute('role', 'option');
        tile.setAttribute('aria-label', `Page ${n}`);
        tile.innerHTML = `<div class="organize-box"><div class="organize-paper"><span class="organize-tick">${iconSvg('check', 'icon-sm')}</span></div></div><span class="organize-num">${n}</span>`;
        const previous = shown.find((t) => t.dataset.page === String(n));
        const canvas = previous?.querySelector('canvas');
        if (canvas) {
            tile.querySelector('.organize-paper').style.cssText = previous.querySelector('.organize-paper').style.cssText;
            tile.querySelector('.organize-paper').prepend(canvas);
        }
        el.append(tile);
        observer.observe(tile);
    }
    const drop = document.createElement('div');
    drop.className = 'organize-drop-line';
    drop.hidden = true;
    el.append(drop);
    tab.organizeGrid = { el, doc: tab.pdfDocument, observer, scrollTop: old?.scrollTop ?? 0 };
    if (tab.signed || tab.signatures?.length) addSignatureBadges(tab, tab.organizeGrid);
}

function visibleTiles(grid) {
    const view = $('organizeView')?.getBoundingClientRect();
    if (!view) return [];
    return [...grid.querySelectorAll('.organize-tile')].filter((t) => overlaps(t.getBoundingClientRect(), view));
}

async function drawTile(tab, tile) {
    const grid = tab.organizeGrid;
    try {
        const page = await tab.pdfDocument.getPage(Number(tile.dataset.page));
        const { width, height } = page.getViewport({ scale: 1 });
        // As wide as the box allows, or as tall: the page keeps its shape.
        const fit = Math.min(1, BOX_RATIO * (width / height));
        const paper = tile.querySelector('.organize-paper');
        paper.style.setProperty('--fit-w', String(fit));
        paper.style.setProperty('--fit-h', String((fit * height) / width));
        const cssWidth = Math.round(thumbSize * fit);
        const canvas = await renderPageCanvas(page, cssWidth);
        if (tab.organizeGrid !== grid) return;
        canvas.dataset.width = String(cssWidth);
        canvas.removeAttribute('style');
        paper.querySelector('canvas')?.remove();
        paper.prepend(canvas);
    } catch (err) {
        if (tab.organizeGrid === grid) console.debug('Organize thumbnail failed:', err);
    }
}

async function addSignatureBadges(tab, grid) {
    let fields = null;
    try {
        fields = await tab.pdfDocument.getFieldObjects();
    } catch (err) {
        console.debug('Reading signature fields failed:', err);
    }
    if (tab.organizeGrid !== grid) return;
    for (const [page, count] of signatureCounts(fields)) {
        const paper = grid.el.querySelector(`.organize-tile[data-page="${page}"] .organize-paper`);
        if (!paper) continue;
        const badge = document.createElement('span');
        badge.className = 'pill success organize-sigs';
        badge.innerHTML = iconSvg('signature', 'icon-sm');
        badge.append(plural(count, 'signature'));
        paper.append(badge);
    }
}

/** Draws thumbnails at the new size, sharper where they grew. */
function setThumbSize(size) {
    thumbSize = Math.min(SIZE.max, Math.max(SIZE.min, size));
    const input = $('organizeSize');
    if (input) {
        input.value = String(thumbSize);
        input.style.setProperty('--range-fill', `${((thumbSize - SIZE.min) / (SIZE.max - SIZE.min)) * 100}%`);
    }
    $('organizeView')?.style.setProperty('--organize-thumb', `${thumbSize}px`);
    const tab = getActivePDF();
    const grid = tab?.organizeGrid;
    if (!grid) return;
    for (const canvas of grid.el.querySelectorAll('.organize-paper canvas')) {
        const tile = canvas.closest('.organize-tile');
        const fit = Number(tile.querySelector('.organize-paper').style.getPropertyValue('--fit-w')) || 1;
        if (Number(canvas.dataset.width) < Math.round(thumbSize * fit)) grid.observer.observe(tile);
    }
}

function chooseThumbSize(size) {
    sizeChosen = true;
    setThumbSize(size);
}

/** Ctrl Plus / Ctrl Minus while organizing: one size step larger (1) or smaller (-1), as the pill's buttons. True when taken. */
export function stepThumbSize(direction) {
    if (!getActivePDF()?.organizing) return false;
    // The tiles move under an open menu.
    closeOpenMenu();
    chooseThumbSize(thumbSize + direction * SIZE.step);
    return true;
}

function refreshSelection(tab) {
    const grid = tab.organizeGrid?.el;
    if (!grid) return;
    const cursor = cursorOf(tab);
    for (const tile of grid.querySelectorAll('.organize-tile')) {
        const n = Number(tile.dataset.page);
        const on = tab.selection.has(n);
        tile.classList.toggle('is-selected', on);
        tile.setAttribute('aria-selected', String(on));
        tile.classList.toggle('is-cursor', n === cursor);
    }
    const count = tab.selection.size;
    $('organizeCount').textContent = count ? `${count} selected` : 'Organize pages';
    $('organizeClear').hidden = count === 0;
    for (const id of ['organizeRotateLeft', 'organizeRotateRight', 'organizeDuplicate', 'organizeExtract', 'organizeDelete']) {
        $(id).disabled = count === 0 || tab.busy;
    }
}

function refreshBar(tab) {
    $('organizeUndo').disabled = !(tab.undoSteps > 0);
    $('organizeRedo').disabled = !(tab.redoSteps > 0);
    $('organizePageCount').textContent = plural(tab.totalPages, 'page');
    const changes = $('organizeChanges');
    changes.hidden = !tab.modified;
    $('organizeChangesSep').hidden = !tab.modified;
    changes.textContent = tab.undoSteps > 0 ? changesLabel(tab.undoSteps) : 'Changes not saved';
}

function select(tab, pages, anchor = tab.selectionAnchor) {
    tab.selection = new Set(pages);
    tab.selectionAnchor = anchor;
    refreshSelection(tab);
}

// ---------- Actions ----------

/** Runs a page operation from the view; it counts as a change for Done's toast. */
async function run(tab, op) {
    if (!tab || tab.busy) return false;
    const changed = await op();
    if (changed) tab.organizeChanged = true;
    if (state.activeTabId === tab.id) syncOrganize(tab);
    return changed;
}

const ACTIONS = {
    'rotate-left': (tab, pages) => rotatePages(tab, -90, pages),
    'rotate-right': (tab, pages) => rotatePages(tab, 90, pages),
    duplicate: (tab, pages) => duplicatePages(tab, pages),
    delete: (tab, pages) => deletePages(tab, pages),
    extract: (tab, pages) => extractPages(tab, pages),
    'insert-blank': (tab, pages) => insertBlankPage(tab, [pages.at(-1) ?? tab.totalPages]),
    'move-start': (tab, pages) => movePages(tab, 0, pages),
    'move-end': (tab, pages) => movePages(tab, tab.totalPages, pages)
};
// What doesn't change the open document (extract writes a new file).
const READ_ONLY = new Set(['extract']);

function act(name, tab = getActivePDF()) {
    if (!tab?.organizing) return;
    const pages = selectedPages(tab);
    if (name === 'insert-file') {
        // The document tools pick the files and ask where, after the selection by default.
        run(tab, () => insertFromFiles(tab, { at: pages.at(-1) ?? tab.totalPages }));
        return;
    }
    if (!pages.length && !name.startsWith('insert')) return;
    if (READ_ONLY.has(name)) ACTIONS[name](tab, pages);
    else run(tab, () => ACTIONS[name](tab, pages));
}

/**
 * Ctrl Z / Ctrl Shift Z ("undo" / "redo"): page changes while organizing,
 * and in reading when pdf.js has nothing of its own. True when it was taken.
 */
export function handlePageUndo(name) {
    const tab = getActivePDF();
    if (!tab) return false;
    if (drag) return true;
    if (tab.organizing) {
        if (name === 'undo' && tab.undoSteps > 0) run(tab, () => undoPageOp(tab));
        if (name === 'redo' && tab.redoSteps > 0) run(tab, () => redoPageOp(tab));
        return true;
    }
    if (name === 'undo' && shouldUndoPageOp(tab)) {
        undoPageOp(tab);
        return true;
    }
    if (name === 'redo' && shouldRedoPageOp(tab)) {
        redoPageOp(tab);
        return true;
    }
    return false;
}

/** Escape while organizing: clears the selection, then goes back to reading. */
export function escapeOrganize() {
    const tab = getActivePDF();
    if (!tab?.organizing) return false;
    if (tab.selection.size) select(tab, [], null);
    else exitOrganize(tab);
    return true;
}

/** The keys of the organize view (see the bar's tooltips). True when e was taken. */
export function handleOrganizeKey(e) {
    const tab = getActivePDF();
    if (!tab?.organizing || isTyping() || isDialogOpen() || isMenuOpen() || drag) return false;
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    const key = e.key.toLowerCase();
    let name = null;
    if (plain && key === 'r') name = e.shiftKey ? 'rotate-left' : 'rotate-right';
    else if (ctrl && !e.shiftKey && key === 'd') name = 'duplicate';
    else if (plain && !e.shiftKey && e.key === 'Delete') name = 'delete';
    if (name) {
        e.preventDefault();
        act(name, tab);
        return true;
    }
    if (ctrl && !e.shiftKey && key === 'a') {
        e.preventDefault();
        select(tab, Array.from({ length: tab.totalPages }, (_, i) => i + 1), 1);
        return true;
    }
    if (ctrl && key === 'z') {
        e.preventDefault();
        return handlePageUndo(e.shiftKey ? 'redo' : 'undo');
    }
    if (!onGrid()) return false;
    if (plain && !e.shiftKey && e.key === 'Enter' && tab.selection.size) {
        e.preventDefault();
        openPage(tab, selectedPages(tab)[0]);
        return true;
    }
    if (plain && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        moveSelection(tab, e.key, e.shiftKey);
        return true;
    }
    return false;
}

function openPage(tab, page) {
    tab.currentPage = page;
    exitOrganize(tab);
}

/** Arrow keys walk the grid (Shift extends the selection), Home and End go to the ends. */
function moveSelection(tab, key, extend) {
    const tiles = [...tab.organizeGrid.el.querySelectorAll('.organize-tile')];
    const top = tiles[0]?.offsetTop;
    const columns = Math.max(1, tiles.findIndex((t) => t.offsetTop !== top) === -1 ? tiles.length : tiles.findIndex((t) => t.offsetTop !== top));
    const from = cursorOf(tab);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key];
    const to = key === 'Home' ? 1 : key === 'End' ? tab.totalPages : Math.min(tab.totalPages, Math.max(1, from + step));
    tab.lastMoved = to;
    tab.organizeGrid.el.classList.add('is-keyboard');
    if (extend) {
        const anchor = tab.selectionAnchor ?? from;
        select(tab, nextSelection(new Set(), anchor, to, { shift: true }).selection, anchor);
    } else {
        select(tab, [to], to);
    }
    tab.organizeGrid.el.querySelector(`.organize-tile[data-page="${to}"]`)?.scrollIntoView?.({ block: 'nearest' });
}
/** The page the arrow keys go from: the last one they moved to, the selection's anchor, or the reading view's page. */
function cursorOf(tab) {
    return tab.selectionAnchor && tab.selection.size ? tab.lastMoved ?? tab.selectionAnchor : tab.currentPage;
}

// ---------- Pointer: select, rubber band, drag ----------

let press = null; // { tab, page, x, y, mods, pointerId, wasSelected }
let band = null; // { tab, x, y, base, el }
let drag = null; // { tab, pages, gap, ghost, x, y, raf }
let shownTab = null; // the tab syncOrganize last showed

const tileAt = (target) => target.closest?.('.organize-tile');
const pageOf = (tile) => Number(tile.dataset.page);
const mods = (e) => ({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
// Keeps the pointer's moves coming to the view when it leaves it.
const capture = (el, id) => {
    try {
        el.setPointerCapture?.(id);
    } catch {
        // Not an active pointer (synthetic events); moves still arrive over the view.
    }
};

function onPointerDown(e) {
    const tab = getActivePDF();
    if (!tab?.organizing || e.button !== 0 || tab.busy) return;
    tab.lastMoved = null;
    tab.organizeGrid?.el.classList.remove('is-keyboard');
    const tile = tileAt(e.target);
    const view = $('organizeView');
    if (!tile) {
        if (e.target.closest('.organize-grid') === null && e.target !== view) return;
        const { ctrl, shift } = mods(e);
        const el = document.createElement('div');
        el.className = 'organize-band';
        el.hidden = true;
        view.append(el);
        band = { tab, x: e.clientX, y: e.clientY, base: ctrl || shift ? [...tab.selection] : [], el, moved: false };
        capture(view, e.pointerId);
        return;
    }
    const page = pageOf(tile);
    const m = mods(e);
    const wasSelected = tab.selection.has(page);
    if (m.shift) {
        const next = nextSelection(tab.selection, tab.selectionAnchor, page, m);
        select(tab, next.selection, next.anchor);
    } else if (!m.ctrl && !wasSelected) {
        select(tab, [page], page);
    }
    press = { tab, page, x: e.clientX, y: e.clientY, mods: m, wasSelected, pointerId: e.pointerId };
    capture(view, e.pointerId);
}

function onPointerMove(e) {
    if (band) {
        moveBand(e);
        return;
    }
    if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
        placeDrag();
        return;
    }
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START) return;
    const { tab, page } = press;
    if (!tab.selection.has(page)) select(tab, [...tab.selection, page], page);
    press = null;
    startDrag(tab, e);
}

function onPointerUp(e) {
    if (band) {
        const { tab, moved, el } = band;
        el.remove();
        band = null;
        if (!moved && !e.ctrlKey && !e.shiftKey) select(tab, [], null);
        return;
    }
    if (drag) {
        drop();
        return;
    }
    if (!press) return;
    const { tab, page, mods: m, wasSelected } = press;
    press = null;
    if (m.ctrl && !m.shift) {
        const next = nextSelection(tab.selection, tab.selectionAnchor, page, m);
        select(tab, next.selection, next.anchor);
    } else if (!m.shift && wasSelected) {
        select(tab, [page], page);
    }
}

function moveBand(e) {
    const { tab, x, y, base, el } = band;
    if (!band.moved && Math.hypot(e.clientX - x, e.clientY - y) < DRAG_START) return;
    band.moved = true;
    const box = { left: Math.min(x, e.clientX), right: Math.max(x, e.clientX), top: Math.min(y, e.clientY), bottom: Math.max(y, e.clientY) };
    const view = $('organizeView').getBoundingClientRect();
    el.hidden = false;
    Object.assign(el.style, {
        left: `${box.left - view.left}px`, top: `${box.top - view.top + $('organizeView').scrollTop}px`,
        width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`
    });
    const rects = [...tab.organizeGrid.el.querySelectorAll('.organize-paper')].map((p) => p.getBoundingClientRect());
    select(tab, [...new Set([...base, ...bandHits(rects, box)])], tab.selectionAnchor);
}

function startDrag(tab, e) {
    const pages = selectedPages(tab);
    const grid = tab.organizeGrid.el;
    for (const p of pages) grid.querySelector(`.organize-tile[data-page="${p}"]`)?.classList.add('is-dragging');
    const ghost = document.createElement('div');
    ghost.className = 'organize-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const source = grid.querySelector(`.organize-tile[data-page="${pages[0]}"] canvas`);
    for (let i = Math.min(pages.length, 3) - 1; i >= 0; i--) {
        const sheet = document.createElement('div');
        sheet.className = 'organize-ghost-sheet';
        sheet.style.setProperty('--layer', String(i));
        if (i === 0 && source) {
            const copy = document.createElement('canvas');
            copy.width = source.width;
            copy.height = source.height;
            copy.getContext('2d')?.drawImage(source, 0, 0);
            sheet.append(copy);
        }
        ghost.append(sheet);
    }
    if (pages.length > 1) {
        const count = document.createElement('span');
        count.className = 'organize-ghost-count';
        count.textContent = String(pages.length);
        ghost.append(count);
    }
    document.body.append(ghost);
    $('organizePill').classList.add('is-dragging');
    drag = { tab, pages, gap: null, ghost, x: e.clientX, y: e.clientY, raf: 0 };
    document.addEventListener('keydown', onDragKey, true);
    placeDrag();
    placeToasts();
    drag.raf = requestAnimationFrame(autoScroll);
}

function placeDrag() {
    const { tab, pages, ghost, x, y } = drag;
    ghost.style.transform = `translate(${x}px, ${y}px)`;
    const grid = tab.organizeGrid.el;
    const tiles = [...grid.querySelectorAll('.organize-tile')];
    const slot = dropSlot(tiles.map((t) => t.firstChild.getBoundingClientRect()), x, y);
    const line = grid.querySelector('.organize-drop-line');
    const moves = Boolean(moveOrder(tab.totalPages, pages, slot.gap));
    drag.gap = moves ? slot.gap : null;
    line.hidden = !moves;
    if (moves) {
        const origin = grid.getBoundingClientRect();
        Object.assign(line.style, {
            left: `${slot.line.x - origin.left}px`, top: `${slot.line.top - origin.top}px`, height: `${slot.line.bottom - slot.line.top}px`
        });
    }
    const text = moves ? dragLabel(pages.length, slot.gap) : `Drag to move ${plural(pages.length, 'page')}`;
    if ($('organizeDragText').textContent !== text) {
        $('organizeDragText').textContent = text;
        placeToasts();
    }
}

function autoScroll() {
    if (!drag) return;
    const view = $('organizeView');
    const { top, bottom } = view.getBoundingClientRect();
    const speed = drag.y < top + EDGE ? -(top + EDGE - drag.y) : drag.y > bottom - EDGE ? drag.y - (bottom - EDGE) : 0;
    if (speed) {
        view.scrollTop += Math.round(speed / 3);
        placeDrag();
    }
    drag.raf = requestAnimationFrame(autoScroll);
}

// While dragging, no key reaches the app (Ctrl Tab or Ctrl W would leave the drag on another tab); Escape cancels it.
function onDragKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') cancelDrag();
}

function endDrag() {
    if (!drag) return null;
    const ended = drag;
    drag = null;
    cancelAnimationFrame(ended.raf);
    ended.ghost.remove();
    document.removeEventListener('keydown', onDragKey, true);
    $('organizePill')?.classList.remove('is-dragging');
    placeToasts();
    const grid = ended.tab.organizeGrid?.el;
    grid?.querySelector('.organize-drop-line')?.setAttribute('hidden', '');
    for (const tile of grid?.querySelectorAll('.is-dragging') ?? []) tile.classList.remove('is-dragging');
    return ended;
}

function cancelDrag() {
    endDrag();
    press = null;
}

function endGestures() {
    cancelDrag();
    band?.el.remove();
    band = null;
}

function drop() {
    const { tab, pages, gap } = endDrag();
    if (gap !== null) run(tab, () => movePages(tab, gap, pages));
}

// ---------- Context menu ----------

function onContextMenu(e) {
    const tab = getActivePDF();
    if (!tab?.organizing || tab.busy) return;
    const fromKeyboard = e.detail === 0 && e.button !== 2;
    // Shift F10 and the Menu key aim at the focused view: the menu opens on the cursor's page.
    const hit = tileAt(e.target);
    const tile = hit ?? (fromKeyboard ? tab.organizeGrid?.el.querySelector(`.organize-tile[data-page="${cursorOf(tab)}"]`) : null);
    if (!tile) return;
    e.preventDefault();
    const page = pageOf(tile);
    if (!tab.selection.has(page)) select(tab, [page], page);
    const count = tab.selection.size;
    $('organizeMenuTitle').textContent = count === 1 ? `Page ${selectedPages(tab)[0]}` : `${count} pages`;
    let { clientX: x, clientY: y } = e;
    if (!hit) {
        tile.scrollIntoView?.({ block: 'nearest' });
        const box = tile.firstChild.getBoundingClientRect();
        x = box.left + box.width / 2;
        y = box.top + box.height / 2;
    }
    openMenuAt($('organizeMenu'), x, y, { returnFocus: $('organizeView'), fromKeyboard });
}

// ---------- Setup ----------

/** Binds the organize view's controls; call once at startup. */
export function initOrganize() {
    $('organizePagesBtn')?.addEventListener('click', () => enterOrganize());
    $('organizeMenuItem')?.addEventListener('click', () => enterOrganize());
    $('organizeDone')?.addEventListener('click', () => exitOrganize());
    $('organizeClear')?.addEventListener('click', () => {
        const tab = getActivePDF();
        if (tab) select(tab, [], null);
    });
    const buttons = {
        organizeRotateLeft: 'rotate-left', organizeRotateRight: 'rotate-right', organizeDuplicate: 'duplicate',
        organizeExtract: 'extract', organizeDelete: 'delete', organizeInsertBlank: 'insert-blank', organizeInsertFile: 'insert-file'
    };
    // A pick from the Insert menu gives the keys back to the grid, as the page menu does below.
    const backToGrid = () => $('organizeView')?.focus({ preventScroll: true });
    for (const [id, name] of Object.entries(buttons)) {
        $(id)?.addEventListener('click', () => {
            act(name);
            if (id.startsWith('organizeInsert')) backToGrid();
        });
    }
    $('organizeUndo')?.addEventListener('click', () => handlePageUndo('undo'));
    $('organizeRedo')?.addEventListener('click', () => handlePageUndo('redo'));
    bindMenu($('organizeInsertBtn'), $('organizeInsertMenu'));
    $('organizeMenu')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-op]');
        if (!item) return;
        act(item.dataset.op);
        backToGrid();
    });

    const size = $('organizeSize');
    size?.addEventListener('input', () => chooseThumbSize(Number(size.value)));
    setThumbSize(thumbSize);
    $('organizeSmaller')?.addEventListener('click', () => stepThumbSize(-1));
    $('organizeLarger')?.addEventListener('click', () => stepThumbSize(1));

    const view = $('organizeView');
    if (view) {
        view.tabIndex = -1;
        view.addEventListener('pointerdown', onPointerDown);
        view.addEventListener('pointermove', onPointerMove);
        view.addEventListener('pointerup', onPointerUp);
        view.addEventListener('pointercancel', endGestures);
        view.addEventListener('contextmenu', onContextMenu);
        view.addEventListener('dblclick', (e) => {
            const tab = getActivePDF();
            const tile = tileAt(e.target);
            if (tab?.organizing && tile) openPage(tab, pageOf(tile));
        });
        view.addEventListener('scroll', () => {
            const tab = getActivePDF();
            if (tab?.organizeGrid) tab.organizeGrid.scrollTop = view.scrollTop;
        });
    }
    // Another tool taking the canvas ends organizing first.
    for (const id of ['markupBtn', 'findBtn', 'signBtn', 'sidePanelBtn']) {
        $(id)?.addEventListener('click', () => leaveOrganize(), true);
    }
}
