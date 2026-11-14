import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, PDFService, RecentFilesService } from '../src/js/backend.js';
import { Browser, System, Window } from '@wailsio/runtime';
import { state } from '../src/js/state.js';

const showChoice = vi.fn();
const showMessage = vi.fn(() => Promise.resolve());
const showConfirm = vi.fn();
const showPrompt = vi.fn();
const closeFindBar = vi.fn();

vi.mock('../src/js/messageDialog.js', () => ({
  showChoice: (...a) => showChoice(...a),
  showMessage: (...a) => showMessage(...a),
  showConfirm: (...a) => showConfirm(...a),
  showPrompt: (...a) => showPrompt(...a)
}));
vi.mock('../src/js/ui.js', () => ({ showSidebars: vi.fn(), hideSidebars: vi.fn() }));
vi.mock('../src/js/sidebar.js', () => ({ setupSidebar: vi.fn(), showSidebarFor: vi.fn(), disposeSidebar: vi.fn() }));
vi.mock('../src/js/findBar.js', () => ({ attachFindBar: vi.fn(), closeFindBar: (...a) => closeFindBar(...a) }));
vi.mock('../src/js/annotationToolbar.js', () => ({ attachAnnotationToolbar: vi.fn(), syncAnnotationToolbar: vi.fn() }));
const loadSignatureInfo = vi.fn();
const clearSignatureInfo = vi.fn();
vi.mock('../src/js/signature.js', () => ({
  loadSignatureInfo: (...a) => loadSignatureInfo(...a),
  clearSignatureInfo: (...a) => clearSignatureInfo(...a)
}));
vi.mock('../src/js/recentFiles.js', () => ({ loadRecentFilesWelcome: vi.fn() }));
vi.mock('../src/js/settings.js', () => ({ getSetting: vi.fn(() => undefined) }));

// Behaves like pdf.js' AnnotationStorage: the modified flag only fires on
// changes, removing the last value resets it, and saveDocument() resets it.
function makeStorage() {
  const values = new Map();
  let modified = false;
  return {
    onSetModified: null,
    onResetModified: null,
    setValue(key, value) {
      values.set(key, value);
      if (!modified) { modified = true; this.onSetModified?.(); }
    },
    remove(key) {
      values.delete(key);
      if (values.size === 0) this.resetModified();
    },
    resetModified() {
      if (modified) { modified = false; this.onResetModified?.(); }
    },
    get serializable() {
      return values.size
        ? { map: new Map(values), hash: JSON.stringify([...values]), transfer: [] }
        : { map: null, hash: '', transfer: undefined };
    },
    get size() { return values.size; }
  };
}

const docs = [];
const views = [];
// Per-load overrides of the loading task, consumed in order: (task, onPassword, doc) => void
const loadHooks = [];
vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { NONE: 0 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  loadDocument: vi.fn((url, onPassword) => {
    const listeners = {};
    const annotationStorage = makeStorage();
    const doc = {
      numPages: 3,
      annotationStorage,
      // The original file plus every stored value, like an incremental save.
      saveDocument: vi.fn(async () => {
        const { map } = annotationStorage.serializable;
        const bytes = new TextEncoder().encode('PDF' + (map ? JSON.stringify([...map]) : ''));
        await Promise.resolve();
        annotationStorage.resetModified();
        return bytes;
      }),
      getData: vi.fn(async () => new TextEncoder().encode('PDF')),
      listeners
    };
    docs.push(doc);
    const task = { promise: Promise.resolve(doc), destroy: vi.fn(() => Promise.resolve()) };
    loadHooks.shift()?.(task, onPassword, doc);
    return task;
  }),
  createViewer: vi.fn(async (host) => {
    const container = document.createElement('div');
    host.append(container);
    const view = {
      container,
      eventBus: {
        handlers: {},
        on: vi.fn(function (name, fn) { (this.handlers[name] ??= []).push(fn); }),
        dispatch: vi.fn(function (name, payload = {}) { for (const fn of this.handlers[name] ?? []) fn(payload); })
      },
      linkService: { setDocument: vi.fn() },
      findController: {},
      pdfViewer: { setDocument: vi.fn(), update: vi.fn(), annotationEditorMode: 0, currentScaleValue: 'auto' }
    };
    views.push(view);
    return view;
  })
}));

globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const docInfo = (n) => ({ id: `id-${n}`, path: `/files/doc${n}.pdf`, fileName: `doc${n}.pdf` });

let documents;

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="pdfTabsContainer"><div id="homeTab" class="pdf-tab"></div></div>
    <div id="pdfViewer"><div id="welcomeScreen"></div></div>
    <div id="viewerToolbar"></div>
    <span id="fileName"></span><span id="pageCount"></span><span id="fileSize"></span>
    <button id="signBtn"></button>
  `;
  state.openPDFs.clear();
  state.activeTabId = null;
  docs.length = 0;
  views.length = 0;
  loadHooks.length = 0;
  System.IsLinux.mockReturnValue(false);
  showChoice.mockReset();
  showConfirm.mockReset();
  documents = await import('../src/js/documents.js');
});

async function openTab(n = 1) {
  PDFService.OpenPDFByPath.mockResolvedValueOnce(docInfo(n));
  return documents.openFilePath(`/files/doc${n}.pdf`);
}

const edit = (doc, value = 'x', key = 'field') => doc.annotationStorage.setValue(key, { value });
const bytesOf = (doc) => new TextEncoder().encode('PDF' + JSON.stringify([...doc.annotationStorage.serializable.map])).toBase64();

const fire = (n, name, payload) => views[n].eventBus.dispatch(name, payload);
const pointer = (target, type = 'pointerdown') => target.dispatchEvent(new Event(type, { bubbles: true }));
// Like pdf.js rendering a page whose radio group has a selected button: the
// widget writes { value: false } for its siblings, then the layer reports.
const renderRadioPage = (n, key = 'radio-sibling') => {
  docs[n].annotationStorage.setValue(key, { value: false });
  fire(n, 'annotationlayerrendered', { pageNumber: 1 });
};
// Moving or recolouring an editor changes what it serializes to but never
// calls setValue, so pdf.js fires nothing.
const changeWithoutEvent = (doc) => {
  const { hash } = doc.annotationStorage.serializable;
  Object.defineProperty(doc.annotationStorage, 'serializable', { get: () => ({ map: new Map(), hash: hash + 'moved', transfer: [] }) });
};

const tabEl = (id) => document.querySelector(`.pdf-tab[data-tab-id="${id}"]`);

describe('opening', () => {
  it('loads the registered document into its own viewer and records it as recent', async () => {
    const id = await openTab(1);
    const tab = state.openPDFs.get(id);

    expect(tab.docId).toBe('id-1');
    expect(tab.totalPages).toBe(3);
    expect(views[0].pdfViewer.setDocument).toHaveBeenCalledWith(docs[0]);
    expect(views[0].linkService.setDocument).toHaveBeenCalledWith(docs[0], null);
    expect(state.activeTabId).toBe(id);
    expect(RecentFilesService.AddRecent).toHaveBeenCalledWith('/files/doc1.pdf', 3);
  });

  it('switches to the existing tab instead of opening a file twice', async () => {
    const id = await openTab(1);
    await openTab(2);
    const again = await documents.openFilePath('/files/doc1.pdf');

    expect(again).toBe(id);
    expect(state.openPDFs.size).toBe(2);
    expect(state.activeTabId).toBe(id);
  });

  it('asks pdf.js to render the visible pages when a tab is shown again', async () => {
    const first = await openTab(1);
    await openTab(2);
    views[0].pdfViewer.pdfDocument = docs[0];
    views[0].pdfViewer.update.mockClear();
    await documents.switchToTab(first);
    expect(views[0].pdfViewer.update).toHaveBeenCalled();
  });

  it('clears the last document\'s signatures when switching to a tab still loading', async () => {
    const first = await openTab(1);
    const second = await openTab(2);
    views[0].pdfViewer.pdfDocument = docs[0];
    await documents.switchToTab(first);
    expect(loadSignatureInfo).toHaveBeenLastCalledWith('/files/doc1.pdf');
    loadSignatureInfo.mockClear();
    clearSignatureInfo.mockClear();

    await documents.switchToTab(second);
    expect(clearSignatureInfo).toHaveBeenCalled();
    expect(loadSignatureInfo).not.toHaveBeenCalled();
  });

  it('disposes the tab when the password prompt is cancelled', async () => {
    // Like pdf.js: the loading promise only settles once the password callback answers.
    loadHooks.push((task, onPassword, doc) => {
      task.promise = new Promise((resolve, reject) => onPassword((answer) => {
        if (answer instanceof Error) reject(Object.assign(new Error('No password given'), { name: 'PasswordException' }));
        else resolve(doc);
      }, 1));
    });
    showPrompt.mockResolvedValueOnce(null);

    expect(await openTab(1)).toBeNull();
    expect(state.openPDFs.size).toBe(0);
    expect(PDFService.ClosePDF).toHaveBeenCalledWith('id-1');
    expect(showMessage).not.toHaveBeenCalled();
    expect(await openTab(2)).not.toBeNull();
  });

  it('goes back to the previous tab when opening fails', async () => {
    const first = await openTab(1);
    loadHooks.push((task) => { task.promise = Promise.reject(new Error('Invalid PDF structure')); });

    await expect(openTab(2)).rejects.toThrow('Invalid PDF structure');
    expect(state.activeTabId).toBe(first);
    expect(views[0].container.classList.contains('hidden')).toBe(false);
  });

  it('shows the welcome screen when the only open fails', async () => {
    loadHooks.push((task) => { task.promise = Promise.reject(new Error('Invalid PDF structure')); });

    await expect(openTab(1)).rejects.toThrow();
    expect(state.activeTabId).toBeNull();
    expect(document.getElementById('welcomeScreen').classList.contains('hidden')).toBe(false);
  });

  it('stays on the welcome screen when an open from there fails', async () => {
    await openTab(1);
    documents.switchToHome();
    loadHooks.push((task) => { task.promise = Promise.reject(new Error('Invalid PDF structure')); });

    await expect(openTab(2)).rejects.toThrow();
    expect(state.activeTabId).toBeNull();
    expect(document.getElementById('welcomeScreen').classList.contains('hidden')).toBe(false);
    expect(views[0].container.classList.contains('hidden')).toBe(true);
  });

  it('stops quietly when the tab is closed while the document loads', async () => {
    // pdf.js never settles a loading task that is destroyed mid-load.
    loadHooks.push((task) => { task.promise = new Promise(() => {}); });
    const opening = openTab(1);
    await vi.waitFor(() => expect(state.openPDFs.size).toBe(1));
    const [id] = state.openPDFs.keys();

    expect(await documents.closeTab(id)).toBe(true);
    expect(await opening).toBeNull();
    expect(PDFService.ClosePDF).toHaveBeenCalledTimes(1);
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('shows the file name, page count and size in the side panel', async () => {
    PDFService.OpenPDFByPath.mockResolvedValueOnce({ ...docInfo(1), size: 25351 });
    await documents.openFilePath('/files/doc1.pdf');
    expect(document.getElementById('fileName').textContent).toBe('doc1.pdf');
    expect(document.getElementById('pageCount').textContent).toBe('3');
    expect(document.getElementById('fileSize').textContent).toBe('24.8 KB');
  });

  it('shows only the active tab viewer', async () => {
    await openTab(1);
    await openTab(2);
    expect(views[0].container.classList.contains('hidden')).toBe(true);
    expect(views[1].container.classList.contains('hidden')).toBe(false);
  });
});

describe('dirty state', () => {
  it('follows the annotation storage and is reported to Go and the title', async () => {
    const id = await openTab(1);
    Window.SetTitle.mockClear();

    edit(docs[0]);
    expect(state.openPDFs.get(id).dirty).toBe(true);
    expect(tabEl(id).classList.contains('dirty')).toBe(true);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), true);
    expect(Window.SetTitle).toHaveBeenLastCalledWith('• doc1.pdf - Lankir');

    docs[0].annotationStorage.remove('field');
    expect(state.openPDFs.get(id).dirty).toBe(false);
    expect(tabEl(id).classList.contains('dirty')).toBe(false);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), false);
    expect(Window.SetTitle).toHaveBeenLastCalledWith('doc1.pdf - Lankir');
  });

  it('stays unsaved while another tab is still dirty', async () => {
    await openTab(1);
    await openTab(2);
    edit(docs[0]);
    edit(docs[1]);
    docs[1].annotationStorage.remove('field');
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), true);
  });
});

describe('dirty state of forms pdf.js writes to while rendering', () => {
  it('keeps an untouched form with a selected radio button clean', async () => {
    const id = await openTab(1);
    renderRadioPage(0);

    expect(state.openPDFs.get(id).dirty).toBe(false);
    expect(await documents.closeTab(id)).toBe(true);
    expect(showChoice).not.toHaveBeenCalled();
  });

  it('keeps a saved tab clean when a page with radio buttons renders later', async () => {
    const id = await openTab(1);
    pointer(views[0].container);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);

    renderRadioPage(0, 'later-page-radio');
    expect(state.openPDFs.get(id).dirty).toBe(false);
  });

  it('keeps the user\'s edits dirty when another page renders', async () => {
    const id = await openTab(1);
    pointer(views[0].container);
    edit(docs[0]);
    renderRadioPage(0);
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('counts toolbar and menu edits as the user\'s', async () => {
    const first = await openTab(1);
    fire(0, 'switchannotationeditorparams', { type: 1, value: '#ff0000' });
    edit(docs[0]);
    renderRadioPage(0);
    expect(state.openPDFs.get(first).dirty).toBe(true);

    const second = await openTab(2);
    fire(1, 'editingaction', { name: 'undo' });
    edit(docs[1]);
    renderRadioPage(1);
    expect(state.openPDFs.get(second).dirty).toBe(true);
  });
});

describe('noticing edits pdf.js reports through no storage callback', () => {
  it('notices an editor moved and released outside the viewer', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);

    vi.useFakeTimers();
    changeWithoutEvent(docs[0]);
    pointer(document.getElementById('viewerToolbar'), 'pointerup');
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('notices a choice field changed through its input event', async () => {
    const id = await openTab(1);
    edit(docs[0], 'x', 'text');
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);
    edit(docs[0], 'xy', 'text');
    edit(docs[0], 'x', 'text');
    vi.useFakeTimers();
    views[0].container.dispatchEvent(new Event('keyup'));
    vi.advanceTimersByTime(200);
    expect(state.openPDFs.get(id).dirty).toBe(false);

    // pdf.js' modified flag is still set, so this write fires no callback.
    const select = document.createElement('select');
    views[0].container.append(select);
    edit(docs[0], 'Option B', 'choice');
    select.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('re-checks once per burst of pointer and key events', async () => {
    await openTab(1);
    const read = vi.spyOn(docs[0].annotationStorage, 'serializable', 'get');
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      pointer(views[0].container, 'pointerup');
      views[0].container.dispatchEvent(new Event('keyup'));
    }
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('has Go ask before closing the window while pdf.js holds any edit, even saved ones', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);

    expect(state.openPDFs.get(id).dirty).toBe(false);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), true);

    // Go asks; nothing is really unsaved, so the window closes at once.
    await documents.handleCloseRequested();
    expect(showChoice).not.toHaveBeenCalled();
    expect(App.ConfirmClose).toHaveBeenCalled();
  });

  it('asks at window close about an edit no event reported', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);
    changeWithoutEvent(docs[0]);
    showChoice.mockResolvedValueOnce('cancel');

    await documents.handleCloseRequested();
    expect(showChoice).toHaveBeenCalled();
    expect(App.ConfirmClose).not.toHaveBeenCalled();
  });
});

describe('closing a tab', () => {
  it('closes a clean tab without asking and releases pdf.js and the registry entry', async () => {
    const id = await openTab(1);
    const task = state.openPDFs.get(id).loadingTask;

    expect(await documents.closeTab(id)).toBe(true);
    expect(showChoice).not.toHaveBeenCalled();
    expect(task.destroy).toHaveBeenCalled();
    expect(views[0].pdfViewer.setDocument).toHaveBeenLastCalledWith(null);
    expect(views[0].container.isConnected).toBe(false);
    expect(PDFService.ClosePDF).toHaveBeenCalledWith('id-1');
    expect(tabEl(id)).toBeNull();
    expect(state.openPDFs.size).toBe(0);
    expect(state.activeTabId).toBeNull();
  });

  it('keeps a dirty tab open when the user cancels', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    showChoice.mockResolvedValueOnce('cancel');

    expect(await documents.closeTab(id)).toBe(false);
    expect(state.openPDFs.has(id)).toBe(true);
    expect(PDFService.ClosePDF).not.toHaveBeenCalled();
  });

  it('treats dismissing the dialog as cancel', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    showChoice.mockResolvedValueOnce(null);

    expect(await documents.closeTab(id)).toBe(false);
    expect(state.openPDFs.has(id)).toBe(true);
  });

  it('discards edits when the user chooses not to save', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    showChoice.mockResolvedValueOnce('discard');

    expect(await documents.closeTab(id)).toBe(true);
    expect(PDFService.SavePDF).not.toHaveBeenCalled();
    expect(state.openPDFs.has(id)).toBe(false);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), false);
  });

  it('saves first when the user chooses save', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    showChoice.mockResolvedValueOnce('save');
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));

    expect(await documents.closeTab(id)).toBe(true);
    expect(PDFService.SavePDF).toHaveBeenCalledWith('id-1', bytesOf(docs[0]), false);
    expect(state.openPDFs.has(id)).toBe(false);
  });

  it('stays open when saving fails', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    showChoice.mockResolvedValueOnce('save');
    PDFService.SavePDF.mockRejectedValueOnce(new Error('disk full'));

    expect(await documents.closeTab(id)).toBe(false);
    expect(state.openPDFs.get(id).dirty).toBe(true);
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'), expect.any(String), 'error');
  });
});

describe('saving', () => {
  it('writes the pdf.js bytes and marks the tab clean', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));

    expect(await documents.saveTab(id)).toBe(true);
    expect(docs[0].saveDocument).toHaveBeenCalled();
    expect(state.openPDFs.get(id).dirty).toBe(false);
  });

  it('save as asks before replacing another file and retargets the tab', async () => {
    const id = await openTab(1);
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/other.pdf', exists: true });
    showConfirm.mockResolvedValueOnce(true);
    PDFService.SavePDFAs.mockResolvedValueOnce({ id: 'id-1', path: '/files/other.pdf', fileName: 'other.pdf' });

    expect(await documents.saveTab(id, { saveAs: true })).toBe(true);
    expect(showConfirm).toHaveBeenCalled();
    expect(PDFService.SavePDFAs).toHaveBeenCalledWith('id-1', '/files/other.pdf', 'UERG');
    const tab = state.openPDFs.get(id);
    expect(tab.filePath).toBe('/files/other.pdf');
    expect(tabEl(id).querySelector('.pdf-tab-name').textContent).toBe('other');
  });

  it('save, then save again writes the same edited bytes', async () => {
    const id = await openTab(1);
    edit(docs[0], 'first');
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1)).mockResolvedValueOnce(docInfo(1));

    expect(await documents.saveTab(id)).toBe(true);
    expect(await documents.saveTab(id)).toBe(true);
    const [[, first], [, second]] = PDFService.SavePDF.mock.calls;
    expect(first).toBe(bytesOf(docs[0]));
    expect(second).toBe(first);
  });

  it('stays dirty when the write fails although pdf.js reset its modified flag', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockRejectedValueOnce(new Error('read-only'));

    expect(await documents.saveTab(id)).toBe(false);
    expect(state.openPDFs.get(id).dirty).toBe(true);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), true);
  });

  it('stays dirty when the user edits while the save is in flight', async () => {
    const id = await openTab(1);
    edit(docs[0], 'first');
    PDFService.SavePDF.mockImplementationOnce(async () => {
      edit(docs[0], 'typed during save');
      return docInfo(1);
    });

    expect(await documents.saveTab(id)).toBe(true);
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('keeps "unsaved changes" in the tab tooltip when Save as ends with edits made during it', async () => {
    const id = await openTab(1);
    edit(docs[0], 'first');
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/other.pdf', exists: false });
    PDFService.SavePDFAs.mockImplementationOnce(async () => {
      edit(docs[0], 'typed during save');
      return { id: 'id-1', path: '/files/other.pdf', fileName: 'other.pdf' };
    });

    expect(await documents.saveTab(id, { saveAs: true })).toBe(true);
    expect(state.openPDFs.get(id).dirty).toBe(true);
    expect(tabEl(id).dataset.tip).toBe('/files/other.pdf (unsaved changes)');
  });

  it('is dirty again when the saved edit is removed', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);
    expect(state.openPDFs.get(id).dirty).toBe(false);

    // Deleting or undoing the only edit fires no storage callback after a
    // save (pdf.js' flag is already clear); the key or click that did it does.
    vi.useFakeTimers();
    docs[0].annotationStorage.remove('field');
    views[0].container.dispatchEvent(new Event('keyup'));
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('asks before closing when a saved edit changed without a modified event', async () => {
    const id = await openTab(1);
    edit(docs[0], 'first');
    PDFService.SavePDF.mockResolvedValueOnce(docInfo(1));
    await documents.saveTab(id);
    changeWithoutEvent(docs[0]);
    showChoice.mockResolvedValueOnce('cancel');

    expect(await documents.closeTab(id)).toBe(false);
    expect(showChoice).toHaveBeenCalled();
  });

  it('save as does nothing when the user declines to replace', async () => {
    const id = await openTab(1);
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/other.pdf', exists: true });
    showConfirm.mockResolvedValueOnce(false);

    expect(await documents.saveTab(id, { saveAs: true })).toBe(false);
    expect(PDFService.SavePDFAs).not.toHaveBeenCalled();
  });
});

describe('closing the window', () => {
  it('asks for every dirty tab and closes when none is cancelled', async () => {
    await openTab(1);
    await openTab(2);
    await openTab(3);
    edit(docs[0]);
    edit(docs[2]);
    showChoice.mockResolvedValueOnce('discard').mockResolvedValueOnce('discard');

    await documents.handleCloseRequested();
    expect(showChoice).toHaveBeenCalledTimes(2);
    expect(App.ConfirmClose).toHaveBeenCalled();
  });

  it('keeps the window open when one dirty tab is cancelled', async () => {
    await openTab(1);
    await openTab(2);
    edit(docs[0]);
    edit(docs[1]);
    showChoice.mockResolvedValueOnce('cancel');

    await documents.handleCloseRequested();
    expect(showChoice).toHaveBeenCalledTimes(1);
    expect(App.ConfirmClose).not.toHaveBeenCalled();
  });
});

describe('a signature placement on a tab', () => {
  it('is cancelled when the tab is hidden or closed', async () => {
    const first = await openTab(1);
    const second = await openTab(2);
    const tab = state.openPDFs.get(second);
    tab.cancelPlacement = vi.fn();
    documents.switchToHome();
    expect(tab.cancelPlacement).toHaveBeenCalled();

    await documents.switchToTab(second);
    tab.cancelPlacement = vi.fn();
    await documents.switchToTab(first);
    expect(tab.cancelPlacement).toHaveBeenCalled();

    const other = state.openPDFs.get(first);
    other.cancelPlacement = vi.fn();
    await documents.closeTab(first);
    expect(other.cancelPlacement).toHaveBeenCalled();
  });
});

describe('closing the active tab', () => {
  it('closes the find bar', async () => {
    const id = await openTab(1);
    const tab = state.openPDFs.get(id);
    await documents.closeTab(id);
    expect(closeFindBar).toHaveBeenCalledWith(tab);
  });
});

describe('links in a document', () => {
  const click = (href) => {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    views[0].container.append(link);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event;
  };

  it('opens web and mail links in the system browser', async () => {
    await openTab(1);
    expect(click('https://example.com/').defaultPrevented).toBe(true);
    expect(click('mailto:a@example.com').defaultPrevented).toBe(true);
    expect(Browser.OpenURL).toHaveBeenCalledWith('https://example.com/');
    expect(Browser.OpenURL).toHaveBeenCalledWith('mailto:a@example.com');
  });

  it('never lets another external link navigate the app', async () => {
    await openTab(1);
    for (const href of ['ftp://example.com/x', 'tel:123', 'file:///etc/passwd', 'other.pdf#page=2', 'javascript:alert(1)']) {
      expect(click(href).defaultPrevented).toBe(true);
    }
    expect(Browser.OpenURL).not.toHaveBeenCalled();
  });

  it('leaves in-document links to pdf.js', async () => {
    await openTab(1);
    expect(click('#page=2').defaultPrevented).toBe(false);
    expect(click('').defaultPrevented).toBe(false);
  });
});

describe('reporting unsaved changes to Go', () => {
  it('numbers each report so Go can drop late ones', async () => {
    await openTab(1);
    edit(docs[0]);
    docs[0].annotationStorage.remove('field');
    const seqs = App.SetUnsavedChanges.mock.calls.map(([seq]) => seq);
    expect(seqs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    expect(App.SetUnsavedChanges).toHaveBeenLastCalledWith(expect.any(Number), false);
  });
});

describe('save conflicts', () => {
  const conflict = (reason) => Object.assign(new Error('conflict'), { cause: { conflict: reason, path: '/files/doc1.pdf' } });

  it('asks before overwriting a file that changed on disk', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockRejectedValueOnce(conflict('changed')).mockResolvedValueOnce(docInfo(1));
    showChoice.mockResolvedValueOnce('overwrite');

    expect(await documents.saveTab(id)).toBe(true);
    expect(showChoice).toHaveBeenCalledWith(expect.stringContaining('changed on disk'), expect.any(String), expect.any(Array));
    expect(PDFService.SavePDF).toHaveBeenLastCalledWith('id-1', bytesOf(docs[0]), true);
    expect(state.openPDFs.get(id).dirty).toBe(false);
  });

  it('keeps the edits when the user cancels the overwrite', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockRejectedValueOnce(conflict('changed'));
    showChoice.mockResolvedValueOnce('cancel');

    expect(await documents.saveTab(id)).toBe(false);
    expect(PDFService.SavePDF).toHaveBeenCalledTimes(1);
    expect(showMessage).not.toHaveBeenCalled();
    expect(state.openPDFs.get(id).dirty).toBe(true);
  });

  it('can save elsewhere instead', async () => {
    const id = await openTab(1);
    edit(docs[0]);
    PDFService.SavePDF.mockRejectedValueOnce(conflict('changed'));
    showChoice.mockResolvedValueOnce('saveAs');
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/copy.pdf', exists: false });
    PDFService.SavePDFAs.mockResolvedValueOnce({ id: 'id-1', path: '/files/copy.pdf', fileName: 'copy.pdf' });

    expect(await documents.saveTab(id)).toBe(true);
    expect(PDFService.SavePDFAs).toHaveBeenCalledWith('id-1', '/files/copy.pdf', bytesOf(docs[0]));
  });

  it('offers to close another tab showing the Save As target', async () => {
    const first = await openTab(1);
    const second = await openTab(2);
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/doc1.pdf', exists: true });
    showChoice.mockResolvedValueOnce('close');
    PDFService.SavePDFAs.mockResolvedValueOnce({ id: 'id-2', path: '/files/doc1.pdf', fileName: 'doc1.pdf' });

    expect(await documents.saveTab(second, { saveAs: true })).toBe(true);
    expect(showChoice).toHaveBeenCalledWith(expect.stringContaining('open in another tab'), expect.any(String), expect.any(Array));
    expect(state.openPDFs.has(first)).toBe(false);
    expect(PDFService.SavePDFAs).toHaveBeenCalledWith('id-2', '/files/doc1.pdf', expect.any(String));
  });

  it('does nothing when the user keeps the other tab', async () => {
    const first = await openTab(1);
    const second = await openTab(2);
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/files/doc1.pdf', exists: true });
    showChoice.mockResolvedValueOnce('cancel');

    expect(await documents.saveTab(second, { saveAs: true })).toBe(false);
    expect(state.openPDFs.has(first)).toBe(true);
    expect(PDFService.SavePDFAs).not.toHaveBeenCalled();
  });
});

describe('saving on Linux', () => {
  const response = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body });

  it('uploads the raw bytes to the document route', async () => {
    System.IsLinux.mockReturnValue(true);
    const id = await openTab(1);
    edit(docs[0]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(200, JSON.stringify(docInfo(1))));

    expect(await documents.saveTab(id)).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe('/doc/id-1');
    expect(init.method).toBe('PUT');
    expect(new TextDecoder().decode(init.body)).toContain('"field"');
    expect(PDFService.SavePDF).not.toHaveBeenCalled();
    expect(state.openPDFs.get(id).dirty).toBe(false);
    fetch.mockRestore();
  });

  it('turns a 409 into the same conflict prompt', async () => {
    System.IsLinux.mockReturnValue(true);
    const id = await openTab(1);
    edit(docs[0]);
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(409, '{"conflict":"changed","path":"/files/doc1.pdf"}'))
      .mockResolvedValueOnce(response(200, JSON.stringify(docInfo(1))));
    showChoice.mockResolvedValueOnce('overwrite');

    expect(await documents.saveTab(id)).toBe(true);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('overwrite')).toBe('1');
    fetch.mockRestore();
  });

  it('reports a failed upload', async () => {
    System.IsLinux.mockReturnValue(true);
    const id = await openTab(1);
    edit(docs[0]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(500, '/files/doc1.pdf is read-only\n'));

    expect(await documents.saveTab(id)).toBe(false);
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('read-only'), expect.any(String), 'error');
    expect(state.openPDFs.get(id).dirty).toBe(true);
    fetch.mockRestore();
  });
});
