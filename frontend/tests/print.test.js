import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const showMessage = vi.fn(() => Promise.resolve());
vi.mock('../src/js/messageDialog.js', () => ({ showMessage: (...a) => showMessage(...a) }));
vi.mock('../src/js/viewer.js', () => ({ AnnotationMode: { ENABLE_STORAGE: 3 }, AnnotationEditorType: { NONE: 0 }, AnnotationEditorParamsType: {}, HIGHLIGHT_COLORS: {} }));

const { printTab } = await import('../src/js/print.js');
const { syncOrganize } = await import('../src/js/organize.js');
const { state } = await import('../src/js/state.js');

// pdf.js pages: A4 portrait except a landscape page 2, rotation already in the viewport.
function makeDoc(sizes = [[595, 842], [842, 595], [595, 842]]) {
  const pages = sizes.map(([w, h]) => ({
    getViewport: ({ scale }) => ({ width: w * scale, height: h * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() }))
  }));
  return {
    numPages: pages.length,
    pages,
    getPage: vi.fn(async (n) => pages[n - 1]),
    getOptionalContentConfig: vi.fn(async () => ({})),
    annotationStorage: { print: { snapshot: true } }
  };
}

let created;
let revoked;
beforeEach(() => {
  created = 0;
  revoked = [];
  HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['png'])); };
  HTMLImageElement.prototype.decode = () => Promise.resolve();
  URL.createObjectURL = vi.fn(() => `blob:${++created}`);
  URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
});
afterEach(() => {
  delete window.print;
});

describe('printing', () => {
  it('shows one rendered image per page to print media, then removes them', async () => {
    const doc = makeDoc();
    let during = null;
    window.print = vi.fn(() => {
      const container = document.getElementById('printContainer');
      during = {
        parent: container?.parentElement,
        pages: container?.querySelectorAll('.print-page img').length,
        srcs: [...(container?.querySelectorAll('img') ?? [])].map((img) => img.getAttribute('src')),
        pageRule: [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('')
      };
    });

    expect(await printTab({ pdfDocument: doc })).toBe(true);
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(during.parent).toBe(document.body);
    expect(during.pages).toBe(3);
    expect(during.srcs).toEqual(['blob:1', 'blob:2', 'blob:3']);
    // The sheet takes the first page's size; the landscape page is fitted onto it.
    expect(during.pageRule).toContain('size: 595pt 842pt');
    // Print media shows only the rendered pages, one per sheet.
    expect(during.pageRule).toMatch(/@media print[\s\S]*body > :not\(#printContainer\)[\s\S]*display: none/);
    expect(during.pageRule).toMatch(/#printContainer \{ display: none; \}/);

    expect(document.getElementById('printContainer')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
    expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
  });

  it('says quietly how far preparing has got, and is gone when the dialog opens', async () => {
    document.body.innerHTML = '<div id="toastRegion"></div>';
    const doc = makeDoc();
    const seen = [];
    doc.getPage.mockImplementation(async (n) => {
      seen.push(document.querySelector('#toastRegion .toast-text')?.textContent);
      return doc.pages[n - 1];
    });
    let atPrint = null;
    // The print dialog blocks the page, so the toast must be gone, not leaving.
    window.print = vi.fn(() => { atPrint = document.querySelector('#toastRegion .toast'); });

    await printTab({ pdfDocument: doc });
    // getPage(1) sizes the sheet before the first page is rendered.
    expect(seen).toEqual([undefined, 'Preparing to print · page 1 of 3', 'Preparing to print · page 2 of 3', 'Preparing to print · page 3 of 3']);
    expect(atPrint).toBeNull();
  });

  it('can be cancelled from its toast while preparing: no dialog, nothing left behind', async () => {
    document.body.innerHTML = '<div id="toastRegion"></div>';
    showMessage.mockClear();
    const doc = makeDoc();
    const bars = [];
    doc.pages[1].render.mockImplementation(() => {
      bars.push(document.querySelector('#toastRegion .toast-progress').style.getPropertyValue('--progress'));
      [...document.querySelectorAll('#toastRegion button')].find((b) => b.textContent === 'Cancel').click();
      return { promise: Promise.resolve() };
    });
    window.print = vi.fn();

    expect(await printTab({ pdfDocument: doc })).toBe(false);
    expect(bars).toEqual([String(1 / 3)]);
    expect(window.print).not.toHaveBeenCalled();
    expect(doc.pages[2].render).not.toHaveBeenCalled();
    expect(showMessage).not.toHaveBeenCalled();
    expect(document.getElementById('printContainer')).toBeNull();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
  });

  it('prints form values and annotations through pdf.js print intent', async () => {
    const doc = makeDoc([[612, 792]]);
    window.print = vi.fn();
    await printTab({ pdfDocument: doc });
    expect(doc.pages[0].render).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'print',
      annotationMode: 3,
      printAnnotationStorage: doc.annotationStorage.print
    }));
    // 150 DPI
    const { viewport } = doc.pages[0].render.mock.calls[0][0];
    expect(viewport.width).toBeCloseTo(612 * 150 / 72);
  });

  it('refuses a second print, from any tab, while one is being prepared, and says why', async () => {
    let release;
    const doc = makeDoc([[100, 100]]);
    doc.getPage.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(doc.pages[0]); }));
    window.print = vi.fn();
    document.body.insertAdjacentHTML('beforeend', '<div id="toastRegion"></div>');
    const first = printTab({ pdfDocument: doc });
    expect(await printTab({ pdfDocument: makeDoc([[100, 100]]) })).toBe(false);
    expect([...document.querySelectorAll('#toastRegion .toast-text')].map((t) => t.textContent)).toContain('Wait for the current change to finish');
    document.getElementById('toastRegion').remove();
    release();
    expect(await first).toBe(true);
    expect(window.print).toHaveBeenCalledTimes(1);
    // Free again afterwards.
    expect(await printTab({ pdfDocument: doc })).toBe(true);
  });

  it('waits for a page operation to finish, and holds off others while it prints', async () => {
    const doc = makeDoc([[100, 100]]);
    const tab = { pdfDocument: doc, busy: true };
    let busyAtPrint = null;
    window.print = vi.fn(() => { busyAtPrint = tab.busy; });
    document.body.insertAdjacentHTML('beforeend', '<div id="toastRegion"></div>');
    expect(await printTab(tab)).toBe(false);
    expect(doc.getPage).not.toHaveBeenCalled();
    expect(document.querySelector('#toastRegion .toast-text').textContent).toBe('Wait for the current change to finish');
    document.getElementById('toastRegion').remove();

    tab.busy = false;
    expect(await printTab(tab)).toBe(true);
    // A page operation's reload would destroy the document being rendered.
    expect(busyAtPrint).toBe(true);
    expect(tab.busy).toBe(false);
  });

  it('gives the organize bar its page actions back once it has printed', async () => {
    const page = document.createElement('template');
    const html = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
    page.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
    for (const el of ['organizeView', 'organizeBar', 'organizePill']) document.body.append(page.content.getElementById(el));
    const doc = makeDoc([[100, 100]]);
    const tab = { id: 7, pdfDocument: doc, totalPages: 1, currentPage: 1, organizing: true, selection: new Set([1]), selectionAnchor: 1 };
    state.openPDFs.set(7, tab);
    state.activeTabId = 7;
    // The selection changing while it prints refreshes the bar while the tab is held.
    window.print = vi.fn(() => syncOrganize(tab));
    expect(await printTab(tab)).toBe(true);
    expect(document.getElementById('organizeRotateLeft').disabled).toBe(false);
    state.openPDFs.delete(7);
    state.activeTabId = null;
  });

  it('cleans up and reports a page that fails to render', async () => {
    const doc = makeDoc();
    doc.pages[1].render.mockReturnValueOnce({ promise: Promise.reject(new Error('bad page')) });
    window.print = vi.fn();
    expect(await printTab({ pdfDocument: doc, fileName: 'a.pdf' })).toBe(false);
    expect(window.print).not.toHaveBeenCalled();
    expect(document.getElementById('printContainer')).toBeNull();
    expect(revoked).toEqual(['blob:1']);
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('bad page'), 'Lankir couldn’t print “a.pdf”', 'error');
  });

  it('does nothing without a loaded document', async () => {
    window.print = vi.fn();
    expect(await printTab(null)).toBe(false);
    expect(await printTab({})).toBe(false);
    expect(window.print).not.toHaveBeenCalled();
  });
});
