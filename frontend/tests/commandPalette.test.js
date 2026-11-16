import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { RecentFilesService } from '../src/js/backend.js';
import { state, createPDFData } from '../src/js/state.js';

const documents = vi.hoisted(() => ({
  openPDFFile: vi.fn(),
  openRecentFile: vi.fn(),
  saveTab: vi.fn(),
  closeTab: vi.fn(),
  switchToHome: vi.fn(),
  switchToNextTab: vi.fn()
}));
const settings = vi.hoisted(() => ({
  shortcuts: {},
  getSetting: vi.fn((key) => (key === 'shortcuts' ? settings.shortcuts : undefined)),
  openSettings: vi.fn(),
  saveSetting: vi.fn(() => Promise.resolve(true))
}));
vi.mock('../src/js/documents.js', () => documents);
vi.mock('../src/js/signature.js', () => ({ signPDF: vi.fn() }));
vi.mock('../src/js/settings.js', () => settings);
vi.mock('../src/js/findBar.js', () => ({ openFindBar: vi.fn(), closeFindBar: vi.fn() }));
vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { DISABLE: -1, NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15 },
  AnnotationEditorParamsType: { CREATE: 2, HIGHLIGHT_COLOR: 31 },
  HIGHLIGHT_COLORS: { yellow: '#FFFF98' },
  loadDocument: vi.fn(),
  renderPageCanvas: vi.fn()
}));

const { initializeUI } = await import('../src/js/ui.js');
const { initCommandPalette, openCommandPalette, fuzzyScore } = await import('../src/js/commandPalette.js');
const { openFindBar } = await import('../src/js/findBar.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel) => document.querySelector(sel);
const isOpen = () => !$('#commandPalette').classList.contains('hidden');
const rows = () => [...document.querySelectorAll('#paletteList [role="option"]')];
const labels = () => rows().map((r) => r.querySelector('.palette-label').textContent);
const row = (label) => rows().find((r) => r.querySelector('.palette-label').textContent === label);
const keysOf = (label) => [...row(label).querySelectorAll('kbd')].map((k) => k.textContent).join(' ');
const selected = () => rows().find((r) => r.getAttribute('aria-selected') === 'true');
const key = (k, init = {}) => $('#paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const type = (text) => {
  const input = $('#paletteInput');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

function openTab() {
  const tab = Object.assign(createPDFData(1, '/docs/contract.pdf', 'doc-1'), {
    pdfDocument: {},
    view: { eventBus: { dispatch: vi.fn(), on: vi.fn() }, pdfViewer: { pdfDocument: {}, annotationEditorMode: 0, pagesCount: 12 } }
  });
  state.openPDFs.set(tab.id, tab);
  state.activeTabId = tab.id;
  return tab;
}

beforeEach(() => {
  document.body.innerHTML = body;
  state.openPDFs.clear();
  state.activeTabId = null;
  settings.shortcuts = {};
  RecentFilesService.GetRecent.mockResolvedValue([]);
  initializeUI();
  initCommandPalette();
});

describe('command palette', () => {
  it('lists commands in groups with their shortcuts as keycaps', () => {
    openTab();
    openCommandPalette();
    expect(isOpen()).toBe(true);
    const groups = [...document.querySelectorAll('#paletteList .palette-group')].map((g) => g.textContent);
    expect(groups).toEqual(['File', 'Document', 'Go', 'View', 'Markup', 'Application']);
    expect(keysOf('Save')).toBe('Ctrl S');
    expect(keysOf('Open file…')).toBe('Ctrl O');
    expect(row('Save').querySelector('svg.icon')).not.toBeNull();
    expect(document.activeElement).toBe($('#paletteInput'));
  });

  it('groups commands as the ≡ menu does: File, then Document, then Go', () => {
    openTab().totalPages = 12;
    state.openPDFs.set(2, { id: 2 });
    openCommandPalette();
    const group = (name) => {
      const head = [...document.querySelectorAll('#paletteList .palette-group')].find((g) => g.textContent === name);
      const out = [];
      for (let el = head.nextElementSibling; el && !el.classList.contains('palette-group'); el = el.nextElementSibling) {
        out.push(el.querySelector('.palette-label').textContent);
      }
      return out;
    };
    expect(group('File')).toEqual(['Open file…', 'Save', 'Save as…', 'Print…', 'Close tab']);
    expect(group('Document')).toEqual(['Sign…', 'Organize pages', 'Insert pages from file…', 'Split into files…', 'Protect with password…',
      'Save optimized copy…', 'Properties…']);
    expect(group('Go')).toEqual(['Find in document', 'Go to page…', 'Next tab', 'Start page']);
    expect(keysOf('Print…')).toBe('Ctrl P');
    settings.shortcuts = { print: 'Control+Shift+p' };
    key('Escape');
    openCommandPalette();
    expect(keysOf('Print…')).toBe('Ctrl Shift P');
  });

  it('shades the list’s edge while more commands are below it', () => {
    openTab();
    const list = $('#paletteList');
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 900 });
    openCommandPalette();
    expect(list.hasAttribute('data-scroll-edges')).toBe(true);
    expect(list.hasAttribute('data-more-below')).toBe(true);
    expect(list.hasAttribute('data-more-above')).toBe(false);
    type('zzzz-nothing');
    expect(list.hasAttribute('data-more-below')).toBe(true); // still the mocked 900; re-measured on each render
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 400 });
    type('save');
    expect(list.hasAttribute('data-more-below')).toBe(false);
  });

  it('heads the ≡ menu’s first group File, as the palette does', () => {
    const heads = [...document.querySelectorAll('#mainMenu .menu-head')].map((h) => h.textContent);
    expect(heads).toEqual(['File', 'Document']);
    expect(document.querySelector('#mainMenu .menu-head').nextElementSibling.id).toBe('saveBtn');
  });

  it('shows the user’s own shortcuts', () => {
    settings.shortcuts = { sign: 'Control+Alt+x' };
    openTab();
    openCommandPalette();
    expect(keysOf('Sign…')).toBe('Ctrl Alt X');
  });

  it('hides document commands when no document is open', () => {
    openCommandPalette();
    expect(labels()).toContain('Open file…');
    expect(labels()).toContain('Settings');
    for (const label of ['Save', 'Save as…', 'Close tab', 'Find in document', 'Fit width', 'Sign…']) {
      expect(labels()).not.toContain(label);
    }
  });

  it('offers the outline only for a document that has one', () => {
    const tab = openTab();
    openCommandPalette();
    expect(labels()).not.toContain('Show outline');
    key('Escape');
    tab.sidebar = { outline: document.createElement('ul') };
    openCommandPalette();
    expect(labels()).toContain('Show outline');
  });

  it('keeps each group together, in their usual order, when two groups match equally well', async () => {
    // A recent file named like a View command ties the File and View groups.
    RecentFilesService.GetRecent.mockResolvedValue([{ filePath: '/docs/Fit page', fileName: 'Fit page' }]);
    openTab();
    openCommandPalette();
    type('fi');
    await vi.waitFor(() => expect(labels()).toContain('Find in document'));
    // The order must not hang on how the engine sorts equal elements: sort back to front.
    const sort = Array.prototype.sort;
    Array.prototype.sort = function (compare) {
      if (!compare) return sort.call(this);
      const out = [];
      for (const item of [...this].reverse()) {
        const at = out.findIndex((other) => compare(item, other) < 0);
        out.splice(at < 0 ? out.length : at, 0, item);
      }
      out.forEach((item, i) => { this[i] = item; });
      return this;
    };
    try {
      type('fit page');
    } finally {
      Array.prototype.sort = sort;
    }
    const groups = [...document.querySelectorAll('#paletteList .palette-group')].map((g) => g.textContent);
    expect(groups.slice(0, 2)).toEqual(['File', 'View']);
    expect(groups).toEqual([...new Set(groups)]);
  });

  it('filters fuzzily and selects the best match', () => {
    openTab();
    openCommandPalette();
    type('fitw');
    expect(selected().querySelector('.palette-label').textContent).toBe('Fit width');
    type('xyzzy');
    expect(rows()).toHaveLength(0);
    expect($('#paletteList').textContent).toContain('No matching commands');
  });

  it('scores word starts above scattered letters', () => {
    expect(fuzzyScore('sa', 'Save as…')).toBeGreaterThan(fuzzyScore('sa', 'Close tab'));
    expect(fuzzyScore('qq', 'Save')).toBeNull();
  });

  it('moves with the arrow keys and runs the selected command on Enter', () => {
    openTab();
    openCommandPalette();
    type('find');
    expect(selected().querySelector('.palette-label').textContent).toBe('Find in document');
    key('ArrowDown');
    key('ArrowUp');
    key('Enter');
    expect(isOpen()).toBe(false);
    expect(openFindBar).toHaveBeenCalled();
  });

  it('goes back to reading for the commands that act on the reading view', async () => {
    const { signPDF } = await import('../src/js/signature.js');
    const tab = openTab();
    for (const label of ['Sign…', 'Find in document', 'Go to page…', 'Show side panel', 'Show pages', 'Show markup tools', 'Fit width']) {
      tab.organizing = true;
      openCommandPalette();
      row(label).click();
      expect(tab.organizing, label).toBe(false);
    }
    expect(signPDF).toHaveBeenCalled();
    expect(openFindBar).toHaveBeenCalled();
  });

  it('runs a command when its row is clicked', () => {
    openTab();
    openCommandPalette();
    row('Save as…').click();
    expect(documents.saveTab).toHaveBeenCalledWith(1, { saveAs: true });
    expect(isOpen()).toBe(false);
  });

  it('closes on Escape and gives focus back', () => {
    const before = $('#openBtn');
    before.focus();
    openCommandPalette();
    key('Escape');
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it('keeps focus in the field when anything but the field is pressed', () => {
    openCommandPalette();
    const press = (el) => !el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(press($('.palette-foot'))).toBe(true);
    expect(press($('.palette-field .keys'))).toBe(true);
    expect(press(rows()[0])).toBe(true);
    expect(press($('#paletteInput'))).toBe(false);
  });

  it('keeps focus in the field on Tab', () => {
    openCommandPalette();
    key('Tab');
    expect(document.activeElement).toBe($('#paletteInput'));
  });

  it('opens from the main menu and from the start page', () => {
    $('#mainMenuBtn').click();
    const first = $('#mainMenu [role="menuitem"]');
    expect(first.textContent).toContain('All commands…');
    first.click();
    expect(isOpen()).toBe(true);
    key('Escape');
    $('#welcomePaletteBtn').click();
    expect(isOpen()).toBe(true);
  });

  it('finds recent files by name', async () => {
    RecentFilesService.GetRecent.mockResolvedValue([
      { filePath: '/docs/Lease agreement.pdf', fileName: 'Lease agreement.pdf', pageCount: 3, lastOpened: '2026-11-12T10:00:00Z' }
    ]);
    openCommandPalette();
    type('lease');
    await vi.waitFor(() => expect(labels()).toContain('Lease agreement.pdf'));
    key('Enter');
    expect(documents.openRecentFile).toHaveBeenCalledWith('/docs/Lease agreement.pdf');
  });

  it('offers to go to a page number', () => {
    const tab = openTab();
    openCommandPalette();
    type('7');
    expect(selected().querySelector('.palette-label').textContent).toBe('Go to page 7');
    key('Enter');
    expect(tab.view.pdfViewer.currentPageNumber).toBe(7);
  });

  it('switches and saves the theme', () => {
    openCommandPalette();
    type('dark theme');
    key('Enter');
    expect(settings.saveSetting).toHaveBeenCalledWith('theme', 'dark');
  });
});
