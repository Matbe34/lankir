import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { RecentFilesService } from '../src/js/backend.js';
import { state, createPDFData } from '../src/js/state.js';

const documents = vi.hoisted(() => ({
  openPDFFile: vi.fn(),
  openRecentFile: vi.fn(),
  saveTab: vi.fn(),
  closeTab: vi.fn(),
  switchToHome: vi.fn()
}));
vi.mock('../src/js/documents.js', () => documents);
vi.mock('../src/js/signature.js', () => ({ signPDF: vi.fn() }));
vi.mock('../src/js/settings.js', () => ({ getSetting: vi.fn(() => undefined), openSettings: vi.fn() }));
vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { DISABLE: -1, NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15 },
  AnnotationEditorParamsType: { CREATE: 2, HIGHLIGHT_COLOR: 31 },
  HIGHLIGHT_COLORS: { yellow: '#FFFF98', green: '#53FFBC' },
  loadDocument: vi.fn(),
  renderPageCanvas: vi.fn()
}));

const { initializeUI, showSidebars } = await import('../src/js/ui.js');
const { initAnnotationToolbar } = await import('../src/js/annotationToolbar.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel) => document.querySelector(sel);
const shown = (sel) => !$(sel).classList.contains('hidden') && !$(sel).hidden;

function openTab(fields = {}) {
  const tab = Object.assign(createPDFData(1, '/docs/contract.pdf', 'doc-1'), {
    pdfDocument: {},
    view: { eventBus: { dispatch: vi.fn(), on: vi.fn() }, pdfViewer: { pdfDocument: {}, annotationEditorMode: 0 } }
  }, fields);
  state.openPDFs.set(tab.id, tab);
  state.activeTabId = tab.id;
  return tab;
}

beforeEach(() => {
  document.body.innerHTML = body;
  state.openPDFs.clear();
  state.activeTabId = null;
  initializeUI();
  initAnnotationToolbar();
});

describe('markup toggle', () => {
  it('shows and hides the markup tools', () => {
    openTab();
    expect(shown('#viewerToolbar')).toBe(false);
    $('#markupBtn').click();
    expect(shown('#viewerToolbar')).toBe(true);
    expect($('#markupBtn').getAttribute('aria-pressed')).toBe('true');
    $('#markupBtn').click();
    expect(shown('#viewerToolbar')).toBe(false);
    expect($('#markupBtn').getAttribute('aria-pressed')).toBe('false');
  });

  it('goes back to selecting text when the tools are hidden', () => {
    const tab = openTab();
    $('#markupBtn').click();
    tab.view.pdfViewer.annotationEditorMode = 9;
    $('#markupBtn').click();
    expect(tab.view.pdfViewer.annotationEditorMode).toEqual({ mode: 0 });
  });
});

describe('side panel', () => {
  it('holds pages, outline and signatures in one panel', () => {
    const panel = $('#sidePanel');
    for (const id of ['pageList', 'outlineView', 'signatureInfo', 'fileName', 'pageCount']) {
      expect(panel.contains(document.getElementById(id)), id).toBe(true);
    }
    expect($('#rightSidebar')).toBeNull();
  });

  it('opens and closes from the header and remembers it for the tab', () => {
    const tab = openTab({ panelOpen: false });
    showSidebars();
    expect(shown('#sidePanel')).toBe(false);
    $('#sidePanelBtn').click();
    expect(shown('#sidePanel')).toBe(true);
    expect($('#sidePanelBtn').getAttribute('aria-pressed')).toBe('true');
    expect(tab.panelOpen).toBe(true);
    $('#sidePanelBtn').click();
    expect(shown('#sidePanel')).toBe(false);
    expect(tab.panelOpen).toBe(false);
  });

  it('keeps its toggle in the header on the start page, disabled until a document shows', () => {
    expect($('#sidePanelBtn').classList.contains('doc-only')).toBe(false);
    expect($('#sidePanelBtn').disabled).toBe(true);
    openTab({ panelOpen: false });
    showSidebars();
    expect($('#sidePanelBtn').disabled).toBe(false);
    state.activeTabId = null;
    showSidebars();
    expect($('#sidePanelBtn').disabled).toBe(true);
  });

  it('switches segments and keeps the choice for the tab', () => {
    const tab = openTab({ panelOpen: true });
    showSidebars();
    $('.tab-btn[data-tab="signatures"]').click();
    expect($('#signaturesTab').classList.contains('active')).toBe(true);
    expect($('#pagesTab').classList.contains('active')).toBe(false);
    expect($('.tab-btn[data-tab="signatures"]').getAttribute('aria-selected')).toBe('true');
    expect(tab.panelTab).toBe('signatures');
  });

  it('shows the segment a tab was left on', () => {
    openTab({ panelOpen: true, panelTab: 'signatures' });
    showSidebars();
    expect(shown('#sidePanel')).toBe(true);
    expect($('#signaturesTab').classList.contains('active')).toBe(true);
  });
});

describe('Open menu', () => {
  const recent = [
    { filePath: '/docs/a.pdf', fileName: 'a.pdf', pageCount: 3, lastOpened: '2026-11-12T10:00:00Z' },
    { filePath: '/docs/b.pdf', fileName: 'b.pdf', pageCount: 1, lastOpened: '2026-11-11T10:00:00Z' }
  ];

  it('lists recent files and opens the one picked', async () => {
    RecentFilesService.GetRecent.mockResolvedValue(recent);
    $('#recentBtn').click();
    await vi.waitFor(() => expect(document.querySelectorAll('#recentMenu [data-path]')).toHaveLength(2));
    expect(shown('#recentMenu')).toBe(true);
    expect($('#recentBtn').getAttribute('aria-expanded')).toBe('true');
    expect($('#recentMenu').textContent).toContain('b.pdf');

    $('#recentMenu [data-path="/docs/b.pdf"]').click();
    expect(documents.openRecentFile).toHaveBeenCalledWith('/docs/b.pdf');
    expect(shown('#recentMenu')).toBe(false);
  });

  it('says when there are no recent files', async () => {
    RecentFilesService.GetRecent.mockResolvedValue([]);
    $('#recentBtn').click();
    await vi.waitFor(() => expect($('#recentMenu').textContent).toContain('No recent files'));
  });

  it('closes on Escape and gives focus back to its button', async () => {
    RecentFilesService.GetRecent.mockResolvedValue(recent);
    $('#recentBtn').click();
    await vi.waitFor(() => expect(document.querySelectorAll('#recentMenu [data-path]')).toHaveLength(2));
    $('#recentMenu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown('#recentMenu')).toBe(false);
    expect(document.activeElement).toBe($('#recentBtn'));
  });
});

describe('main menu', () => {
  it('saves the active tab', () => {
    openTab();
    $('#mainMenuBtn').click();
    expect(shown('#mainMenu')).toBe(true);
    $('#saveAsBtn').click();
    expect(documents.saveTab).toHaveBeenCalledWith(1, { saveAs: true });
    expect(shown('#mainMenu')).toBe(false);
  });
});
