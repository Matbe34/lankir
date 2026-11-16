import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { state } from '../src/js/state.js';
import { showToast } from '../src/js/toast.js';

vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { DISABLE: -1, NONE: 0 },
  AnnotationEditorParamsType: {},
  HIGHLIGHT_COLORS: {},
  renderPageCanvas: vi.fn(async (_page, width) => {
    const canvas = document.createElement('canvas');
    canvas.style.width = `${width}px`;
    return canvas;
  })
}));

const ops = {
  rotatePages: vi.fn(async () => true),
  deletePages: vi.fn(async () => true),
  duplicatePages: vi.fn(async () => true),
  movePages: vi.fn(async () => true),
  insertBlankPage: vi.fn(async () => true),
  extractPages: vi.fn(async () => true),
  undoPageOp: vi.fn(async () => true),
  redoPageOp: vi.fn(async () => true)
};
vi.mock('../src/js/pageOps.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    nextSelection: real.nextSelection,
    moveOrder: real.moveOrder,
    shouldUndoPageOp: real.shouldUndoPageOp,
    shouldRedoPageOp: real.shouldRedoPageOp,
    ...Object.fromEntries(Object.keys(ops).map((name) => [name, (...a) => ops[name](...a)]))
  };
});
const saveTab = vi.fn(async () => true);
vi.mock('../src/js/documents.js', () => ({ saveTab: (...a) => saveTab(...a) }));
vi.mock('../src/js/signature.js', () => ({ closeSignPanel: vi.fn() }));
const insertFromFiles = vi.fn(async () => true);
vi.mock('../src/js/documentTools.js', () => ({ insertFromFiles: (...a) => insertFromFiles(...a) }));

const organize = await import('../src/js/organize.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>'))
  .replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

function fakeTab(pages = 6, fields = {}) {
  return {
    id: 1,
    docId: 'doc-1',
    fileName: 'report.pdf',
    currentPage: 2,
    totalPages: pages,
    selection: new Set(),
    selectionAnchor: null,
    modified: false,
    undoSteps: 0,
    redoSteps: 0,
    editingState: {},
    pdfDocument: {
      numPages: pages,
      getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
      getFieldObjects: async () => null
    },
    view: {
      container: document.createElement('div'),
      eventBus: { dispatch: vi.fn(), on: vi.fn() },
      pdfViewer: { currentPageNumber: 1, update: vi.fn() }
    },
    ...fields
  };
}

const $ = (id) => document.getElementById(id);
const tile = (n) => document.querySelector(`#organizeView .organize-tile[data-page="${n}"]`);
const selected = (tab) => [...tab.selection].sort((a, b) => a - b);
const key = (k, mods = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  return { handled: organize.handleOrganizeKey(e), event: e };
};
function clickTile(n, mods = {}) {
  const el = tile(n);
  const opts = { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, pointerId: 1, ...mods };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
}

let tab;
beforeEach(() => {
  document.body.innerHTML = body;
  organize.initOrganize();
  for (const fn of Object.values(ops)) fn.mockClear();
  saveTab.mockClear();
  state.openPDFs.clear();
  tab = fakeTab();
  state.openPDFs.set(1, tab);
  state.activeTabId = 1;
});

describe('where a drag drops', () => {
  // Two rows of three 100×140 cells, 20 apart.
  const cell = (col, row) => ({ left: col * 120, right: col * 120 + 100, top: row * 160, bottom: row * 160 + 140 });
  const rects = [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1)];

  it('picks the gap by the column as well as the row', () => {
    expect(organize.dropSlot(rects, 10, 50).gap).toBe(0);
    expect(organize.dropSlot(rects, 80, 50).gap).toBe(1);
    expect(organize.dropSlot(rects, 170, 50).gap).toBe(2);
    expect(organize.dropSlot(rects, 300, 50).gap).toBe(3);
    expect(organize.dropSlot(rects, 10, 200).gap).toBe(3);
    expect(organize.dropSlot(rects, 230, 200).gap).toBe(5);
    expect(organize.dropSlot(rects, 330, 200).gap).toBe(6);
  });

  it('draws the line midway between neighbours, and beside a row end', () => {
    expect(organize.dropSlot(rects, 130, 50).line).toEqual({ x: 110, top: 0, bottom: 140 });
    expect(organize.dropSlot(rects, 10, 200).line).toEqual({ x: -10, top: 160, bottom: 300 });
    expect(organize.dropSlot(rects, 330, 200).line).toEqual({ x: 350, top: 160, bottom: 300 });
  });

  it('uses the nearest row from the gap between rows and beyond the last', () => {
    expect(organize.dropSlot(rects, 10, 145).gap).toBe(0);
    expect(organize.dropSlot(rects, 10, 155).gap).toBe(3);
    expect(organize.dropSlot(rects, 130, 900).gap).toBe(4);
  });

  it('says it in words', () => {
    expect(organize.dragLabel(3, 9)).toBe('Drop to move 3 pages after page 9');
    expect(organize.dragLabel(1, 0)).toBe('Drop to move 1 page to the start');
  });
});

describe('labels and badges', () => {
  it('counts unsaved changes', () => {
    expect(organize.changesLabel(1)).toBe('1 change not saved');
    expect(organize.changesLabel(4)).toBe('4 changes not saved');
  });

  it('counts signature fields per page', () => {
    const fields = new Map([
      ['sig1', [{ type: 'signature', page: 5 }]],
      ['sig2', [{ type: 'signature', page: 5 }]],
      ['name', [{ type: 'text', page: 0 }]],
      ['sig3', [{ type: 'signature', page: 0 }]]
    ]);
    expect(organize.signatureCounts(fields)).toEqual(new Map([[6, 2], [1, 1]]));
    expect(organize.signatureCounts(null)).toEqual(new Map());
  });

  it('sizes thumbnails by default so about five columns fit the view', () => {
    // The grid's 32px sides and 24px column gaps: five columns at 160 fill 896 of 1024.
    expect(organize.defaultThumbSize(1024)).toBe(160);
    expect(organize.defaultThumbSize(1440)).toBe(200);
    expect(organize.defaultThumbSize(800)).toBe(120);
    expect(organize.defaultThumbSize(0)).toBe(200); // not laid out yet
  });

  it('selects the cells a rubber band touches', () => {
    const rects = [{ left: 0, right: 100, top: 0, bottom: 140 }, { left: 120, right: 220, top: 0, bottom: 140 }, { left: 240, right: 340, top: 0, bottom: 140 }];
    expect(organize.bandHits(rects, { left: 90, right: 130, top: 10, bottom: 20 })).toEqual([1, 2]);
    expect(organize.bandHits(rects, { left: 101, right: 119, top: 10, bottom: 20 })).toEqual([]);
  });

  it('needs the band at least 4px into a page, so stopping in the gutter beside it selects nothing', () => {
    const rects = [{ left: 0, right: 100, top: 0, bottom: 140 }];
    expect(organize.bandHits(rects, { left: 97, right: 119, top: 10, bottom: 60 })).toEqual([]);
    expect(organize.bandHits(rects, { left: 96, right: 119, top: 10, bottom: 60 })).toEqual([1]);
    expect(organize.bandHits(rects, { left: 10, right: 60, top: 137, bottom: 160 })).toEqual([]);
  });
});

describe('the organize view', () => {
  it('is entered from the Pages panel, not from a header button', () => {
    expect(document.querySelector('.app-header [aria-controls="organizeView"]')).toBeNull();
    const btn = $('organizePagesBtn');
    expect(btn.closest('#pagesTab')).not.toBeNull();
    expect(btn.compareDocumentPosition($('pageList')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(btn.textContent.trim()).toBe('Organize pages');
    expect(btn.dataset.shortcut).toBe('organizePages');
  });

  it('names its commands as the ≡ menu and the palette do', () => {
    const label = (op) => document.querySelector(`#organizeMenu [data-op="${op}"] .menu-label`).textContent;
    expect(label('insert-file')).toBe('Insert pages from file…');
    expect(label('extract')).toBe('Extract…');
    // Rotate shows a page turning, not the circular arrows of undo or reload.
    for (const el of [$('organizeRotateLeft'), document.querySelector('#organizeMenu [data-op="rotate-left"]')]) expect(el.querySelector('[data-icon]').dataset.icon).toBe('rotate-ccw-square');
    for (const el of [$('organizeRotateRight'), document.querySelector('#organizeMenu [data-op="rotate-right"]')]) expect(el.querySelector('[data-icon]').dataset.icon).toBe('rotate-cw-square');
    expect($('organizeInsertFile').textContent).toBe('From file…');
    expect($('organizeExtract').textContent).toBe('Extract…');
    expect($('organizeExtract').dataset.tip).toBe('Extract the selected pages to a new file');
  });

  it('replaces the reading view with a grid of every page, from the Pages panel', async () => {
    $('organizePagesBtn').click();
    expect(tab.organizing).toBe(true);
    expect($('workspace').classList.contains('is-organizing')).toBe(true);
    expect($('organizeView').classList.contains('hidden')).toBe(false);
    expect($('organizeBar').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#organizeView .organize-tile')).toHaveLength(6);
    expect($('organizePageCount').textContent).toBe('6 pages');
  });

  it('keeps organizing per tab', () => {
    organize.enterOrganize(tab);
    const other = fakeTab(2, { id: 2 });
    state.openPDFs.set(2, other);
    state.activeTabId = 2;
    organize.syncOrganize(other);
    expect($('organizeView').classList.contains('hidden')).toBe(true);
    state.activeTabId = 1;
    organize.syncOrganize(tab);
    expect($('organizeView').classList.contains('hidden')).toBe(false);
  });

  it('selects with click, Shift and Ctrl', () => {
    organize.enterOrganize(tab);
    clickTile(3);
    expect(selected(tab)).toEqual([3]);
    clickTile(5, { shiftKey: true });
    expect(selected(tab)).toEqual([3, 4, 5]);
    clickTile(4, { ctrlKey: true });
    expect(selected(tab)).toEqual([3, 5]);
    expect(tile(3).getAttribute('aria-selected')).toBe('true');
    expect(tile(4).getAttribute('aria-selected')).toBe('false');
    expect(document.querySelector('.organize-tile.is-current')).toBeNull();
    expect($('organizeCount').textContent).toBe('2 selected');
  });

  it('fits the thumbnails to the view until the size is chosen, then keeps the choice', () => {
    Object.defineProperty($('organizeView'), 'clientWidth', { configurable: true, get: () => 1024 });
    organize.enterOrganize(tab);
    expect($('organizeSize').value).toBe('160');
    $('organizeLarger').click();
    expect($('organizeSize').value).toBe('180');
    organize.exitOrganize(tab);
    organize.enterOrganize(tab);
    expect($('organizeSize').value).toBe('180');
  });

  it('steps the thumbnail size as the pill’s buttons do, only while organizing', () => {
    Object.defineProperty($('organizeView'), 'clientWidth', { configurable: true, get: () => 1024 });
    expect(organize.stepThumbSize(1)).toBe(false);
    organize.enterOrganize(tab);
    const size = $('organizeSize').value;
    expect(organize.stepThumbSize(1)).toBe(true);
    $('organizeLarger').click();
    expect(Number($('organizeSize').value)).toBe(Number(size) + 40);
    expect(organize.stepThumbSize(-1)).toBe(true);
    $('organizeSmaller').click();
    expect($('organizeSize').value).toBe(size);
    organize.exitOrganize(tab);
    organize.enterOrganize(tab);
    expect($('organizeSize').value).toBe(size);
  });

  it('closes the page menu or the Insert menu before it steps the thumbnail size', () => {
    organize.enterOrganize(tab);
    tile(3).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, detail: 1, clientX: 50, clientY: 60 }));
    expect($('organizeMenu').classList.contains('hidden')).toBe(false);
    organize.stepThumbSize(1);
    expect($('organizeMenu').classList.contains('hidden')).toBe(true);
    $('organizeInsertBtn').click();
    expect($('organizeInsertMenu').classList.contains('hidden')).toBe(false);
    organize.stepThumbSize(-1);
    expect($('organizeInsertMenu').classList.contains('hidden')).toBe(true);
  });

  it('names the bar until pages are selected, then counts them', () => {
    organize.enterOrganize(tab);
    expect($('organizeCount').textContent).toBe('Organize pages');
    expect($('organizeClear').hidden).toBe(true);
    clickTile(3);
    expect($('organizeCount').textContent).toBe('1 selected');
    expect($('organizeClear').hidden).toBe(false);
    $('organizeClear').click();
    expect($('organizeCount').textContent).toBe('Organize pages');
  });

  it('marks where the arrow keys go from, shown only while they are in use', () => {
    organize.enterOrganize(tab);
    const cursor = () => [...document.querySelectorAll('.organize-tile.is-cursor')].map((t) => Number(t.dataset.page));
    const grid = document.querySelector('.organize-grid');
    expect(cursor()).toEqual([2]); // the reading view's page, while nothing is selected
    clickTile(4);
    expect(cursor()).toEqual([4]);
    expect(grid.classList.contains('is-keyboard')).toBe(false);
    key('ArrowRight');
    expect(cursor()).toEqual([5]);
    expect(grid.classList.contains('is-keyboard')).toBe(true);
    clickTile(1);
    expect(cursor()).toEqual([1]);
    expect(grid.classList.contains('is-keyboard')).toBe(false);
  });

  it('disables the page actions while nothing is selected', () => {
    organize.enterOrganize(tab);
    for (const id of ['organizeRotateLeft', 'organizeRotateRight', 'organizeDuplicate', 'organizeExtract', 'organizeDelete']) {
      expect($(id).disabled).toBe(true);
    }
    clickTile(1);
    expect($('organizeDelete').disabled).toBe(false);
    expect($('organizeUndo').disabled).toBe(true);
  });

  it('runs the bar actions on the selection', () => {
    organize.enterOrganize(tab);
    clickTile(2);
    clickTile(4, { ctrlKey: true });
    $('organizeRotateRight').click();
    expect(ops.rotatePages).toHaveBeenLastCalledWith(tab, 90, [2, 4]);
    $('organizeRotateLeft').click();
    expect(ops.rotatePages).toHaveBeenLastCalledWith(tab, -90, [2, 4]);
    $('organizeDuplicate').click();
    expect(ops.duplicatePages).toHaveBeenCalledWith(tab, [2, 4]);
    $('organizeExtract').click();
    expect(ops.extractPages).toHaveBeenCalledWith(tab, [2, 4]);
    $('organizeDelete').click();
    expect(ops.deletePages).toHaveBeenCalledWith(tab, [2, 4]);
    $('organizeInsertBlank').click();
    expect(ops.insertBlankPage).toHaveBeenCalledWith(tab, [4]);
  });

  it('inserts from a file after the selection, from the bar and the page menu, as a change for Done', async () => {
    organize.enterOrganize(tab);
    clickTile(3);
    $('organizeInsertFile').click();
    expect(insertFromFiles).toHaveBeenLastCalledWith(tab, { at: 3 });
    await vi.waitFor(() => expect(tab.organizeChanged).toBe(true));

    tile(5).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    $('organizeMenu').querySelector('[data-op="insert-file"]').click();
    expect(insertFromFiles).toHaveBeenLastCalledWith(tab, { at: 5 });
  });

  it('has the page keys while organizing', () => {
    organize.enterOrganize(tab);
    clickTile(3);
    expect(key('r').handled).toBe(true);
    expect(ops.rotatePages).toHaveBeenLastCalledWith(tab, 90, [3]);
    key('R', { shiftKey: true });
    expect(ops.rotatePages).toHaveBeenLastCalledWith(tab, -90, [3]);
    key('d', { ctrlKey: true });
    expect(ops.duplicatePages).toHaveBeenCalledWith(tab, [3]);
    key('Delete');
    expect(ops.deletePages).toHaveBeenCalledWith(tab, [3]);
    key('a', { ctrlKey: true });
    expect(selected(tab)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never takes a key while typing, in a dialog, in a menu or when reading', () => {
    expect(key('r').handled).toBe(false);
    organize.enterOrganize(tab);
    clickTile(1);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(key('r').handled).toBe(false);
    input.blur();
    $('messageDialog').classList.remove('hidden');
    expect(key('Delete').handled).toBe(false);
    $('messageDialog').classList.add('hidden');
    $('organizeInsertBtn').click();
    expect(key('r').handled).toBe(false);
    expect(ops.rotatePages).not.toHaveBeenCalled();
    expect(ops.deletePages).not.toHaveBeenCalled();
  });

  it('Escape clears the selection, then leaves', () => {
    organize.enterOrganize(tab);
    clickTile(2);
    expect(organize.escapeOrganize()).toBe(true);
    expect(selected(tab)).toEqual([]);
    expect(tab.organizing).toBe(true);
    expect(organize.escapeOrganize()).toBe(true);
    expect(tab.organizing).toBe(false);
    expect(organize.escapeOrganize()).toBe(false);
  });

  it('goes back to the page it was on, with a toast for the changes not saved', () => {
    organize.enterOrganize(tab);
    tab.modified = true;
    tab.undoSteps = 3;
    tab.organizeChanged = true;
    $('organizeDone').click();
    expect(tab.organizing).toBe(false);
    expect($('workspace').classList.contains('is-organizing')).toBe(false);
    expect(tab.view.pdfViewer.currentPageNumber).toBe(2);
    const toast = document.querySelector('#toastRegion .toast');
    expect(toast.querySelector('.toast-text').textContent).toBe('3 unsaved changes');
    const [undo, save] = toast.querySelectorAll('.toast-action');
    save.click();
    expect(saveTab).toHaveBeenCalledWith(1);
    expect(undo.textContent).toBe('Undo');
  });

  it('undo in the toast takes back every unsaved page change', () => {
    organize.enterOrganize(tab);
    Object.assign(tab, { modified: true, undoSteps: 2, organizeChanged: true });
    organize.exitOrganize(tab);
    document.querySelector('#toastRegion .toast-action').click();
    expect(ops.undoPageOp).toHaveBeenCalledWith(tab, 2);
  });

  it('takes the toast away once the changes are saved', async () => {
    organize.enterOrganize(tab);
    Object.assign(tab, { modified: true, undoSteps: 1, organizeChanged: true });
    organize.exitOrganize(tab);
    expect(document.querySelector('#toastRegion .toast:not(.leaving)')).not.toBeNull();
    tab.modified = false;
    organize.syncOrganize(tab);
    expect(document.querySelector('#toastRegion .toast:not(.leaving)')).toBeNull();
  });

  it('shows no toast when nothing changed', () => {
    organize.enterOrganize(tab);
    organize.exitOrganize(tab);
    expect(document.querySelector('#toastRegion .toast')).toBeNull();
  });

  it('opens a context menu that selects the page and moves it to the end', () => {
    organize.enterOrganize(tab);
    clickTile(1);
    tile(3).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    expect(selected(tab)).toEqual([3]);
    expect($('organizeMenu').classList.contains('hidden')).toBe(false);
    expect($('organizeMenuTitle').textContent).toBe('Page 3');
    $('organizeMenu').querySelector('[data-op="move-end"]').click();
    expect(ops.movePages).toHaveBeenCalledWith(tab, 6, [3]);
    expect($('organizeMenu').classList.contains('hidden')).toBe(true);
  });

  it('Ctrl Z and Ctrl Shift Z undo and redo page changes while organizing, and in reading when pdf.js has nothing', () => {
    tab.undoSteps = 1;
    tab.redoSteps = 1;
    tab.editingState = { hasSomethingToUndo: true };
    expect(organize.handlePageUndo('undo')).toBe(false);
    tab.editingState = {};
    expect(organize.handlePageUndo('undo')).toBe(true);
    expect(organize.handlePageUndo('redo')).toBe(true);
    expect(ops.undoPageOp).toHaveBeenCalledTimes(1);
    expect(ops.redoPageOp).toHaveBeenCalledTimes(1);

    organize.enterOrganize(tab);
    tab.undoSteps = 0;
    tab.editingState = { hasSomethingToUndo: true };
    // The hidden reader never gets it while organizing.
    expect(organize.handlePageUndo('undo')).toBe(true);
    expect(ops.undoPageOp).toHaveBeenCalledTimes(1);
  });

  it('shows signature badges on signed pages', async () => {
    tab.signed = true;
    tab.pdfDocument.getFieldObjects = async () => new Map([['s1', [{ type: 'signature', page: 5 }]], ['s2', [{ type: 'signature', page: 5 }]]]);
    organize.enterOrganize(tab);
    await vi.waitFor(() => expect(tile(6).querySelector('.organize-sigs')?.textContent).toBe('2 signatures'));
    expect(tile(1).querySelector('.organize-sigs')).toBeNull();
  });

  it('shows the unsaved changes in the pill', () => {
    Object.assign(tab, { modified: true, undoSteps: 2 });
    organize.enterOrganize(tab);
    expect($('organizeChanges').textContent).toBe('2 changes not saved');
    expect($('organizeChanges').hidden).toBe(false);
  });
});

describe('the organize view’s keys and focus', () => {
  const cursor = () => [...document.querySelectorAll('.organize-tile.is-cursor')].map((t) => Number(t.dataset.page));
  const menuOpen = () => !$('organizeMenu').classList.contains('hidden');

  it('leaves Enter and the arrows to a focused button or the size slider', () => {
    organize.enterOrganize(tab);
    clickTile(3);
    $('organizeDone').focus();
    expect(key('Enter').handled).toBe(false);
    expect(tab.organizing).toBe(true);
    $('organizeSize').focus();
    expect(key('ArrowRight').handled).toBe(false);
    expect(key('Home').handled).toBe(false);
    expect(selected(tab)).toEqual([3]);
    $('organizeView').focus();
    expect(key('ArrowRight').handled).toBe(true);
    expect(selected(tab)).toEqual([4]);
  });

  it('opens the selected page with Enter, and leaves Shift Enter to a shortcut bound to it', () => {
    organize.enterOrganize(tab);
    clickTile(3);
    $('organizeView').focus();
    expect(key('Enter', { shiftKey: true }).handled).toBe(false);
    expect(tab.organizing).toBe(true);
    expect(key('Enter').handled).toBe(true);
    expect(tab.organizing).toBe(false);
    expect(tab.currentPage).toBe(3);
  });

  it('keeps where the arrow keys go from per tab', () => {
    const other = fakeTab(6, { id: 2 });
    state.openPDFs.set(2, other);
    state.activeTabId = 2;
    organize.enterOrganize(other);
    clickTile(2);
    state.activeTabId = 1;
    organize.enterOrganize(tab);
    clickTile(4);
    key('ArrowRight');
    state.activeTabId = 2;
    organize.syncOrganize(other);
    expect(cursor()).toEqual([2]);
  });

  it('draws a tab’s thumbnails again at a size chosen on another tab', () => {
    organize.enterOrganize(tab);
    const first = tile(1);
    const canvas = document.createElement('canvas');
    canvas.dataset.width = '100';
    first.querySelector('.organize-paper').prepend(canvas);
    const other = fakeTab(2, { id: 2 });
    state.openPDFs.set(2, other);
    state.activeTabId = 2;
    organize.enterOrganize(other);
    $('organizeLarger').click();
    const observe = vi.spyOn(tab.organizeGrid.observer, 'observe');
    state.activeTabId = 1;
    organize.syncOrganize(tab);
    expect(observe).toHaveBeenCalledWith(first);
  });

  it('takes Done’s toast away when its tab closes', () => {
    organize.enterOrganize(tab);
    Object.assign(tab, { modified: true, undoSteps: 2, organizeChanged: true });
    organize.exitOrganize(tab);
    expect(document.querySelector('#toastRegion .toast:not(.leaving)')).not.toBeNull();
    organize.disposeOrganize(tab);
    expect(document.querySelector('#toastRegion .toast:not(.leaving)')).toBeNull();
  });

  it('opens the page menu from the keyboard on the cursor’s page', () => {
    organize.enterOrganize(tab);
    clickTile(4);
    tile(4).firstChild.getBoundingClientRect = () => ({ left: 100, right: 200, top: 200, bottom: 340, width: 100, height: 140 });
    // Shift F10 or the Menu key: at the focused view, not at a page.
    $('organizeView').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menuOpen()).toBe(true);
    expect($('organizeMenuTitle').textContent).toBe('Page 4');
    expect($('organizeMenu').style.left).toBe('150px');
    expect($('organizeMenu').style.top).toBe('270px');
    expect(document.activeElement.closest('#organizeMenu')).not.toBeNull();
  });

  it('gives the focus back to the grid after a pick from the page menu or the Insert menu', () => {
    organize.enterOrganize(tab);
    clickTile(3);
    tile(3).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    $('organizeMenu').querySelector('[data-op="move-end"]').click();
    expect(document.activeElement).toBe($('organizeView'));
    $('organizeInsertBtn').click();
    $('organizeInsertBlank').focus();
    $('organizeInsertBlank').click();
    expect(document.activeElement).toBe($('organizeView'));
  });

  it('lifts a toast over the organize pill when organizing brings the pill in', () => {
    const pill = $('organizePill');
    $('pagePill').getClientRects = () => [];
    pill.getClientRects = () => [{}];
    pill.getBoundingClientRect = () => ({ left: 400, right: 800, top: 700, bottom: 740, width: 400, height: 40 });
    $('toastRegion').getBoundingClientRect = () => ({ left: 648, right: 1008, top: 700, bottom: 740, width: 360, height: 40 });
    showToast('Saved');
    expect($('toastRegion').classList.contains('is-lifted')).toBe(false);
    organize.enterOrganize(tab);
    expect($('toastRegion').classList.contains('is-lifted')).toBe(true);
  });

  it('closes the page menu when the tab changes', () => {
    organize.enterOrganize(tab);
    tile(3).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, detail: 1, clientX: 50, clientY: 60 }));
    expect(menuOpen()).toBe(true);
    const other = fakeTab(2, { id: 2 });
    state.openPDFs.set(2, other);
    state.activeTabId = 2;
    organize.syncOrganize(other);
    expect(menuOpen()).toBe(false);
  });
});

describe('dragging pages and the rubber band', () => {
  // Two rows of three 100×140 pages, 20 apart, as in "where a drag drops".
  function layOut() {
    for (let n = 1; n <= 6; n++) {
      const i = n - 1;
      const r = { left: (i % 3) * 120, right: (i % 3) * 120 + 100, top: Math.floor(i / 3) * 160, bottom: Math.floor(i / 3) * 160 + 140 };
      const rect = { ...r, width: 100, height: 140, x: r.left, y: r.top };
      tile(n).firstChild.getBoundingClientRect = () => rect;
      tile(n).querySelector('.organize-paper').getBoundingClientRect = () => rect;
    }
    $('organizeView').getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 });
  }
  const point = (el, type, x, y, init = {}) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...init
  }));
  const view = () => $('organizeView');
  const ghost = () => document.querySelector('.organize-ghost');
  const startDrag = () => {
    organize.enterOrganize(tab);
    layOut();
    point(tile(1), 'pointerdown', 50, 70);
    point(view(), 'pointermove', 300, 70);
  };

  it('moves the pages once the pointer goes 5px, to the gap it is dropped in', () => {
    organize.enterOrganize(tab);
    layOut();
    point(tile(1), 'pointerdown', 50, 70);
    point(view(), 'pointermove', 52, 72);
    expect(ghost()).toBeNull();
    point(view(), 'pointermove', 300, 70);
    expect(ghost()).not.toBeNull();
    expect($('organizeDragText').textContent).toBe('Drop to move 1 page after page 3');
    point(view(), 'pointerup', 300, 70);
    expect(ops.movePages).toHaveBeenCalledWith(tab, 3, [1]);
    expect(ghost()).toBeNull();
  });

  it('does nothing when the pages are dropped where they are', () => {
    organize.enterOrganize(tab);
    layOut();
    point(tile(2), 'pointerdown', 170, 70);
    point(view(), 'pointermove', 130, 70);
    expect(ghost()).not.toBeNull();
    point(view(), 'pointerup', 130, 70);
    expect(ops.movePages).not.toHaveBeenCalled();
  });

  it('Escape cancels a drag', () => {
    startDrag();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(ghost()).toBeNull();
    point(view(), 'pointerup', 300, 70);
    expect(ops.movePages).not.toHaveBeenCalled();
  });

  it('keeps every other key from the app while dragging, and undo too', () => {
    startDrag();
    const app = vi.fn();
    document.addEventListener('keydown', app);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    document.removeEventListener('keydown', app);
    expect(app).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    tab.undoSteps = 1;
    expect(organize.handlePageUndo('undo')).toBe(true);
    expect(ops.undoPageOp).not.toHaveBeenCalled();
    expect(ghost()).not.toBeNull();
  });

  it('ends a drag when the tab changes or closes', () => {
    startDrag();
    const other = fakeTab(2, { id: 2 });
    state.openPDFs.set(2, other);
    state.activeTabId = 2;
    organize.syncOrganize(other);
    expect(ghost()).toBeNull();
    point(view(), 'pointerup', 300, 70);
    expect(ops.movePages).not.toHaveBeenCalled();

    state.activeTabId = 1;
    organize.syncOrganize(tab);
    layOut();
    point(tile(1), 'pointerdown', 50, 70);
    point(view(), 'pointermove', 300, 70);
    expect(ghost()).not.toBeNull();
    organize.disposeOrganize(tab);
    expect(ghost()).toBeNull();
  });

  it('places a showing toast again as the drag widens and narrows the pill', () => {
    const pill = $('organizePill');
    const lifted = () => $('toastRegion').classList.contains('is-lifted');
    $('pagePill').getClientRects = () => [];
    pill.getClientRects = () => [{}];
    // The drag text is longer than the pill's size controls.
    pill.getBoundingClientRect = () => (pill.classList.contains('is-dragging')
      ? { left: 200, right: 800, top: 700, bottom: 740, width: 600, height: 40 }
      : { left: 400, right: 600, top: 700, bottom: 740, width: 200, height: 40 });
    $('toastRegion').getBoundingClientRect = () => ({ left: 648, right: 1008, top: 700, bottom: 740, width: 360, height: 40 });
    organize.enterOrganize(tab);
    showToast('Saved');
    expect(lifted()).toBe(false);
    layOut();
    point(tile(1), 'pointerdown', 50, 70);
    point(view(), 'pointermove', 300, 70);
    expect(lifted()).toBe(true);
    point(view(), 'pointerup', 300, 70);
    expect(lifted()).toBe(false);
  });

  it('selects the pages a rubber band reaches', () => {
    organize.enterOrganize(tab);
    layOut();
    const grid = document.querySelector('.organize-grid');
    point(grid, 'pointerdown', 5, 5);
    point(view(), 'pointermove', 230, 100);
    expect(document.querySelector('.organize-band').hidden).toBe(false);
    point(view(), 'pointerup', 230, 100);
    expect(selected(tab)).toEqual([1, 2]);
    expect(document.querySelector('.organize-band')).toBeNull();
  });
});
