import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { PDFService, SignatureService } from '../src/js/backend.js';
import { state } from '../src/js/state.js';

const showConfirm = vi.fn();
const showDialog = vi.fn();
const showMessage = vi.fn(() => Promise.resolve());
const showPrompt = vi.fn();
vi.mock('../src/js/messageDialog.js', () => ({
  showConfirm: (...a) => showConfirm(...a),
  showDialog: (...a) => showDialog(...a),
  showMessage: (...a) => showMessage(...a),
  showPrompt: (...a) => showPrompt(...a),
  showChoice: vi.fn()
}));

// documents.js talks to Go and pdf.js; these stand in with the same contract.
const documents = vi.hoisted(() => ({
  reloadTab: vi.fn(async (tab, { doc } = {}) => {
    if (doc) {
      tab.modified = doc.modified;
      tab.undoSteps = doc.undoSteps;
    }
  }),
  pushWorkingCopy: vi.fn(async () => ({ modified: true, undoSteps: 1 })),
  exportBytes: vi.fn(async () => ({})),
  exportOptionsFor: (tab, { protect = true } = {}) => {
    const password = protect ? tab.protect ?? tab.password ?? '' : '';
    if (password) return { rewrite: true, password, optimize: false };
    return tab.encrypted && tab.password ? { rewrite: true, password: '', optimize: false } : null;
  },
  hasUnsavedEdits: vi.fn(() => false),
  refreshDirty: vi.fn((tab) => Boolean(tab.modified) || tab.protect !== undefined),
  saveTab: vi.fn(async () => true)
}));
vi.mock('../src/js/documents.js', () => documents);

// Each inserted file loads in pdf.js once, to count its pages and ask its password.
const loaded = [];
const loadDocument = vi.fn((url, onPassword) => {
  const file = loaded.shift();
  const task = { destroy: vi.fn(async () => {}) };
  task.promise = (async () => {
    let password = null;
    if (file.password) {
      password = await new Promise((resolve, reject) => onPassword((p) => (p instanceof Error ? reject(p) : resolve(p)), 1));
    }
    return { numPages: file.pages, getData: async () => file.bytes, password };
  })();
  return task;
});
vi.mock('../src/js/viewer.js', () => ({
  loadDocument: (...a) => loadDocument(...a),
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  PDFDateString: { toDateObject: (s) => (s ? new Date(Date.UTC(Number(s.slice(2, 6)), Number(s.slice(6, 8)) - 1, Number(s.slice(8, 10)))) : null) }
}));
const printTab = vi.fn(async () => true);
vi.mock('../src/js/print.js', () => ({ printTab: (...a) => printTab(...a) }));

const tools = await import('../src/js/documentTools.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel) => document.querySelector(sel);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (dialog, label) => [...dialog.querySelectorAll('.modal-footer button')].find((b) => b.textContent.trim() === label);
const primary = (dialog) => dialog.querySelector('.modal-footer .btn-primary');

function makeTab(fields = {}) {
  const tab = {
    id: 1,
    docId: 'doc-1',
    fileName: 'Master Services Agreement.pdf',
    filePath: '/home/u/Documents/Master Services Agreement.pdf',
    fileSize: 2_400_000,
    totalPages: 12,
    currentPage: 3,
    selection: new Set(),
    modified: false,
    undoSteps: 0,
    signed: false,
    editingState: {},
    pdfDocument: {
      numPages: 12,
      extractPages: vi.fn(async (infos) => new TextEncoder().encode(JSON.stringify(infos.map((i) => ({ ...i, document: i.document && 'bytes' }))))),
      saveDocument: vi.fn(async () => new Uint8Array([1])),
      getMetadata: vi.fn(async () => ({
        info: {
          Title: 'Master Services Agreement', Author: 'Northwind Legal', Subject: '', Keywords: 'msa',
          Creator: 'Writer', Producer: 'LibreOffice 24.8', PDFFormatVersion: '1.7',
          CreationDate: 'D:20261103120000Z', ModDate: 'D:20261110091400Z'
        }
      }))
    },
    ...fields
  };
  state.openPDFs.set(tab.id, tab);
  state.activeTabId = tab.id;
  return tab;
}
// The pageInfos the last rebuild asked pdf.js for, an inserted file's bytes shown as 'bytes'.
const sentInfos = (tab) => tab.pdfDocument.extractPages.mock.calls.at(-1)[0].map((i) => ({ ...i, document: i.document && 'bytes' }));

beforeEach(() => {
  document.body.innerHTML = '<div id="toastRegion"></div>';
  state.openPDFs.clear();
  state.activeTabId = null;
  loaded.length = 0;
  showConfirm.mockReset();
  showDialog.mockReset();
  showPrompt.mockReset();
  SignatureService.VerifySignaturesOffline.mockResolvedValue([]);
});

describe('what Split writes', () => {
  it('one file per range, named after the document', () => {
    expect(tools.splitPlan('ranges', '1-3, 4-12', 12, 'Contract')).toEqual([
      { name: 'Contract_part1.pdf', pages: [1, 2, 3] },
      { name: 'Contract_part2.pdf', pages: [4, 5, 6, 7, 8, 9, 10, 11, 12] }
    ]);
  });

  it('a lone number among ranges is that page, not a page count', () => {
    expect(tools.splitPlan('ranges', '5', 12, 'c')).toEqual([{ name: 'c_part1.pdf', pages: [5] }]);
  });

  it('every N pages leaves the rest to the last file', () => {
    expect(tools.splitPlan('every', '5', 12, 'c').map((f) => f.pages.length)).toEqual([5, 5, 2]);
  });

  it('says what is wrong with the field', () => {
    expect(() => tools.splitPlan('ranges', '1-3, 9-14', 12, 'c')).toThrow('outside 1–12');
    expect(() => tools.splitPlan('every', 'two', 12, 'c')).toThrow('Enter how many pages each file gets.');
    expect(() => tools.splitPlan('every', '0', 12, 'c')).toThrow('at least 1');
    expect(() => tools.splitPlan('ranges', ' ', 12, 'c')).toThrow();
  });
});

describe('Split dialog', () => {
  async function openSplit(fields) {
    const tab = makeTab(fields);
    const done = tools.splitDocument(tab);
    await flush();
    return { tab, done, dialog: $('#splitDialog') };
  }

  it('previews the files as the ranges are typed, and names how many it writes', async () => {
    const { dialog } = await openSplit();
    type(dialog.querySelector('#splitRanges'), '1-3, 4-9, 10-12');
    expect([...dialog.querySelectorAll('.split-files .list-row-title')].map((el) => el.textContent))
      .toEqual(['Master Services Agreement_part1.pdf', 'Master Services Agreement_part2.pdf', 'Master Services Agreement_part3.pdf']);
    expect([...dialog.querySelectorAll('.ribbon-part')].map((p) => p.querySelectorAll('.ribbon-page').length)).toEqual([3, 6, 3]);
    expect(dialog.querySelector('.split-files .list-row-sub').textContent).toBe('Pages 1–3');
    expect(dialog.querySelector('.split-files .pill')).toBeNull(); // the range says it; no page count again
    expect(primary(dialog).textContent).toBe('Split into 3 files');

    type(dialog.querySelector('#splitRanges'), '1-3, 9-14');
    expect(dialog.querySelector('#splitError').textContent).toContain('outside 1–12');
    expect(dialog.querySelector('#splitRanges').getAttribute('aria-invalid')).toBe('true');
    expect(primary(dialog).disabled).toBe(true);
  });

  it('switches to a page count per file', async () => {
    const { dialog } = await openSplit();
    dialog.querySelector('[data-mode="every"]').click();
    type(dialog.querySelector('#splitRanges'), '4');
    expect(dialog.querySelectorAll('.split-files .list-row')).toHaveLength(3);
    expect(dialog.querySelector('[data-mode="every"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes nothing until a folder is chosen in the dialog', async () => {
    const { tab, dialog } = await openSplit();
    type(dialog.querySelector('#splitRanges'), '1-3, 4-12');
    expect(primary(dialog).disabled).toBe(true);
    PDFService.ChooseExportFolder.mockResolvedValueOnce('/home/u/Documents/Parts');
    dialog.querySelector('#splitFolderBtn').click();
    await vi.waitFor(() => expect(primary(dialog).disabled).toBe(false));
    expect(PDFService.ChooseExportFolder).toHaveBeenCalledWith(tab.docId);
    // A long path loses its middle, never the folder's own name.
    expect(dialog.querySelector('.save-row .path-tail').textContent).toBe('Parts');
    expect(dialog.querySelector('.save-row .path-head').textContent).toBe('~/Documents/');
  });

  it('writes each part as a new file, without changing the document or asking about signatures', async () => {
    SignatureService.VerifySignaturesOffline.mockResolvedValue([{ signerName: 'A' }]);
    const { tab, done, dialog } = await openSplit();
    type(dialog.querySelector('#splitRanges'), '1-3, 4-12');
    PDFService.ChooseExportFolder.mockResolvedValueOnce('/out');
    dialog.querySelector('#splitFolderBtn').click();
    await vi.waitFor(() => expect(primary(dialog).disabled).toBe(false));
    primary(dialog).click();

    expect(await done).toBe(true);
    expect(documents.exportBytes).toHaveBeenCalledTimes(2);
    expect(documents.exportBytes).toHaveBeenNthCalledWith(1, tab, '/out/Master Services Agreement_part1.pdf', expect.any(Uint8Array), false, null);
    expect(tab.pdfDocument.extractPages.mock.calls[1][0]).toEqual([{ document: null, includePages: [3, 4, 5, 6, 7, 8, 9, 10, 11] }]);
    expect(tab.modified).toBe(false);
    expect(documents.pushWorkingCopy).not.toHaveBeenCalled();
    expect(SignatureService.VerifySignaturesOffline).not.toHaveBeenCalled();
    expect($('#splitDialog')).toBeNull();
    expect($('#toastRegion').textContent).toContain('Split into 2 files in “out”');
  });

  it('keeps the password on the parts of a protected document unless unticked', async () => {
    const { tab, done, dialog } = await openSplit({ password: 'pw', encrypted: true });
    const protect = dialog.querySelector('#splitProtect');
    expect(protect.checked).toBe(true);
    PDFService.ChooseExportFolder.mockResolvedValueOnce('/out');
    dialog.querySelector('#splitFolderBtn').click();
    await vi.waitFor(() => expect(primary(dialog).disabled).toBe(false));
    primary(dialog).click();
    await done;
    expect(documents.exportBytes.mock.calls.every((c) => c[4]?.password === 'pw')).toBe(true);

    documents.exportBytes.mockClear();
    const again = tools.splitDocument(tab);
    await flush();
    const second = $('#splitDialog');
    second.querySelector('#splitProtect').click();
    PDFService.ChooseExportFolder.mockResolvedValueOnce('/out2');
    second.querySelector('#splitFolderBtn').click();
    await vi.waitFor(() => expect(primary(second).disabled).toBe(false));
    primary(second).click();
    await again;
    expect(documents.exportBytes.mock.calls.every((c) => c[4]?.rewrite && c[4].password === '')).toBe(true);
  });

  it('an unprotected document offers no password option', async () => {
    const { dialog } = await openSplit();
    expect(dialog.querySelector('#splitProtect')).toBeNull();
  });

  it('stops at a part that already exists, says so in the dialog and replaces nothing', async () => {
    const { tab, done, dialog } = await openSplit();
    type(dialog.querySelector('#splitRanges'), '1-3, 4-6, 7-12');
    PDFService.ChooseExportFolder.mockResolvedValueOnce('/out');
    dialog.querySelector('#splitFolderBtn').click();
    await vi.waitFor(() => expect(primary(dialog).disabled).toBe(false));
    documents.exportBytes
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Save conflict', { cause: { conflict: 'exists', path: '/out/Master Services Agreement_part2.pdf' } }));
    primary(dialog).click();

    await vi.waitFor(() => expect(dialog.querySelector('#splitNotice').hidden).toBe(false));
    const notice = dialog.querySelector('#splitNotice').textContent;
    expect(notice).toContain('“Master Services Agreement_part2.pdf” is already in this folder');
    expect(notice).toContain('Only “Master Services Agreement_part1.pdf” was written.');
    expect(documents.exportBytes).toHaveBeenCalledTimes(2);
    expect(documents.exportBytes.mock.calls.every((c) => c[3] === false)).toBe(true);
    expect(primary(dialog).disabled).toBe(false);
    expect(tab.busy).toBe(false);

    button(dialog, 'Cancel').click();
    expect(await done).toBe(false);
  });
});

describe('Insert pages from file', () => {
  const notes = { id: 'notes-1', path: '/home/u/notes.pdf', fileName: 'notes.pdf' };

  async function openInsert(fields, options) {
    const tab = makeTab(fields);
    PDFService.OpenPDFs.mockResolvedValueOnce([notes]);
    loaded.push({ pages: 2, bytes: new Uint8Array([7]) });
    const done = tools.insertFromFiles(tab, options);
    await vi.waitFor(() => expect($('#insertDialog')).not.toBeNull());
    return { tab, done, dialog: $('#insertDialog') };
  }

  it('lists the files and inserts their pages at the end, as an undoable working copy', async () => {
    const { tab, done, dialog } = await openInsert();
    expect(dialog.querySelector('.list-row-title').textContent).toBe('notes.pdf');
    expect(dialog.querySelector('.list-row-sub').textContent).toBe('2 pages');
    expect(primary(dialog).textContent).toBe('Insert 2 pages');
    expect(dialog.querySelector('[data-where="end"]').getAttribute('aria-pressed')).toBe('true');
    primary(dialog).click();

    expect(await done).toBe(true);
    expect(sentInfos(tab)).toEqual([{ document: null }, { document: 'bytes' }]);
    expect(documents.pushWorkingCopy).toHaveBeenCalled();
    expect(documents.reloadTab).toHaveBeenCalledWith(tab, expect.objectContaining({ page: 13 }));
    expect(tab.selection).toEqual(new Set([13, 14]));
    expect(PDFService.ClosePDF).toHaveBeenCalledWith('notes-1');
  });

  it('at the start or after the current page', async () => {
    let { tab, done, dialog } = await openInsert();
    dialog.querySelector('[data-where="start"]').click();
    primary(dialog).click();
    await done;
    expect(sentInfos(tab)[1]).toEqual({ document: 'bytes', insertAfter: -1 });

    ({ tab, done, dialog } = await openInsert());
    expect(dialog.querySelector('[data-where="after"]').textContent).toBe('After page 3');
    dialog.querySelector('[data-where="after"]').click();
    primary(dialog).click();
    await done;
    expect(sentInfos(tab)[1]).toEqual({ document: 'bytes', insertAfter: 2 });
    expect(tab.selection).toEqual(new Set([4, 5]));
  });

  it('starts at the position the Organize view asked for', async () => {
    const { tab, done, dialog } = await openInsert({}, { at: 7 });
    expect(dialog.querySelector('[data-where="after"]').textContent).toBe('After page 7');
    expect(dialog.querySelector('[data-where="after"]').getAttribute('aria-pressed')).toBe('true');
    primary(dialog).click();
    await done;
    expect(sentInfos(tab)[1]).toEqual({ document: 'bytes', insertAfter: 6 });
  });

  it('asks for a protected file’s password and hands it to pdf.js', async () => {
    const tab = makeTab();
    PDFService.OpenPDFs.mockResolvedValueOnce([notes]);
    loaded.push({ pages: 2, bytes: new Uint8Array([7]), password: true });
    showPrompt.mockResolvedValueOnce('np');
    const done = tools.insertFromFiles(tab);
    await vi.waitFor(() => expect($('#insertDialog')).not.toBeNull());
    expect(showPrompt).toHaveBeenCalledWith(expect.any(String), '“notes.pdf” needs a password', expect.objectContaining({ type: 'password' }));
    primary($('#insertDialog')).click();
    await done;
    expect(tab.pdfDocument.extractPages.mock.calls[0][0][1].password).toBe('np');
  });

  it('warns about a signed document before anything else, once', async () => {
    SignatureService.VerifySignaturesOffline.mockResolvedValue([{ signerName: 'Jordi' }]);
    showDialog.mockResolvedValueOnce(false);
    const tab = makeTab();
    expect(await tools.insertFromFiles(tab)).toBe(false);
    expect(PDFService.OpenPDFs).not.toHaveBeenCalled();

    showDialog.mockResolvedValueOnce(true);
    PDFService.OpenPDFs.mockResolvedValueOnce([notes]);
    loaded.push({ pages: 2, bytes: new Uint8Array([7]) });
    const done = tools.insertFromFiles(tab);
    await vi.waitFor(() => expect($('#insertDialog')).not.toBeNull());
    primary($('#insertDialog')).click();
    expect(await done).toBe(true);
    expect(showDialog).toHaveBeenCalledTimes(2);
  });

  it('cancelling closes the picked files and changes nothing', async () => {
    const { done, dialog } = await openInsert();
    button(dialog, 'Cancel').click();
    expect(await done).toBe(false);
    expect(documents.pushWorkingCopy).not.toHaveBeenCalled();
    expect(PDFService.ClosePDF).toHaveBeenCalledWith('notes-1');
  });
});

describe('protection', () => {
  it('sets the password for the next save once both fields match', async () => {
    const tab = makeTab();
    const done = tools.protectDocument(tab);
    await flush();
    const dialog = $('#protectDialog');
    expect(dialog.querySelector('h2').textContent).toBe('Protect with password');
    expect(dialog.textContent).toContain('can’t be recovered');
    type(dialog.querySelector('#protectPassword'), 'secret');
    type(dialog.querySelector('#protectConfirm'), 'secrex');
    primary(dialog).click();
    await flush();
    expect(dialog.querySelector('#protectError').textContent).toBe('The passwords don’t match.');
    expect(dialog.querySelector('#protectConfirm').getAttribute('aria-invalid')).toBe('true');
    expect(tab.protect).toBeUndefined();

    type(dialog.querySelector('#protectConfirm'), 'secret');
    primary(dialog).click();
    expect(await done).toBe(true);
    expect(tab.protect).toBe('secret');
    expect(documents.refreshDirty).toHaveBeenCalledWith(tab);
  });

  it('a protected document changes its password', async () => {
    const tab = makeTab({ password: 'old', encrypted: true });
    tools.protectDocument(tab);
    await flush();
    expect($('#protectDialog h2').textContent).toBe('Change password');
  });

  it('removing asks first and applies on save', async () => {
    const tab = makeTab({ password: 'old', encrypted: true });
    showConfirm.mockResolvedValueOnce(true);
    expect(await tools.removeProtection(tab)).toBe(true);
    expect(tab.protect).toBe('');
    expect(showConfirm.mock.calls[0][2]).toEqual(expect.objectContaining({ danger: true }));
  });

  it('removing a password only set in this session just forgets it', async () => {
    const tab = makeTab({ protect: 'new' });
    expect(await tools.removeProtection(tab)).toBe(true);
    expect(tab.protect).toBeUndefined();
    expect(showConfirm).not.toHaveBeenCalled();
  });
});

describe('properties', () => {
  async function openProperties(fields) {
    const tab = makeTab(fields);
    const done = tools.editProperties(tab);
    await vi.waitFor(() => expect($('#propertiesDialog')).not.toBeNull());
    return { tab, done, dialog: $('#propertiesDialog') };
  }

  it('shows the facts and the editable description', async () => {
    const { dialog } = await openProperties({ password: 'pw', encrypted: true });
    expect(dialog.querySelector('#propTitle').value).toBe('Master Services Agreement');
    expect(dialog.querySelector('#propKeywords').value).toBe('msa');
    const facts = Object.fromEntries([...dialog.querySelectorAll('.fact')].map((f) => [f.querySelector('dt').textContent, f.querySelector('dd').textContent]));
    expect(facts).toMatchObject({
      File: 'Master Services Agreement.pdf', Size: '2.3 MB', Pages: '12', 'PDF version': '1.7',
      Producer: 'LibreOffice 24.8', Protected: 'Yes', Signed: 'No'
    });
    expect(facts.Created).toMatch(/2026/);
    expect(primary(dialog).disabled).toBe(true);
  });

  it('lays its details out as label and value rows beside the fields, in one label style', async () => {
    const { dialog } = await openProperties();
    const grid = dialog.querySelector('.form-grid');
    expect(grid.querySelector('dl.facts')).not.toBeNull();
    for (const dt of grid.querySelectorAll('.fact > dt')) expect(dt.className).toBe('field-label');
    expect(dialog.querySelector('.facts-grid')).toBeNull();
  });

  it('labels its fields as Split and Protect do', async () => {
    const { dialog } = await openProperties();
    const labels = [...dialog.querySelectorAll('.form-grid label')];
    expect(labels.map((l) => l.textContent)).toEqual(['Title', 'Author', 'Subject', 'Keywords']);
    for (const label of labels) expect(label.className).toBe('field-label');
  });

  it('applies changed fields as an undoable change, keeping creator and producer', async () => {
    const { tab, done, dialog } = await openProperties();
    PDFService.SetMetadata.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    type(dialog.querySelector('#propAuthor'), 'Northwind Legal Team');
    expect(primary(dialog).disabled).toBe(false);
    primary(dialog).click();
    expect(await done).toBe(true);
    expect(PDFService.SetMetadata).toHaveBeenCalledWith('doc-1', {
      Title: 'Master Services Agreement', Author: 'Northwind Legal Team', Subject: '', Keywords: 'msa', Creator: 'Writer', Producer: 'LibreOffice 24.8'
    });
    expect(tab.modified).toBe(true);
  });
});

describe('revert, optimized copy and print', () => {
  it('reverting names what is lost, then reloads the saved file', async () => {
    const tab = makeTab({ modified: true, undoSteps: 2, protect: 'x' });
    showConfirm.mockResolvedValueOnce(true);
    PDFService.RevertToSaved.mockResolvedValueOnce({ modified: false, undoSteps: 0 });
    expect(await tools.revertToSaved(tab)).toBe(true);
    expect(showConfirm.mock.calls[0][0]).toContain('page and property changes and the password change');
    expect(tab.protect).toBeUndefined();
    expect(documents.reloadTab).toHaveBeenCalledWith(tab, { doc: { modified: false, undoSteps: 0 } });
  });

  it('a clean document has nothing to revert', async () => {
    expect(await tools.revertToSaved(makeTab())).toBe(false);
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('an optimized copy is a Save as that shrinks the file', async () => {
    const tab = makeTab();
    await tools.saveOptimizedCopy(tab);
    expect(documents.saveTab).toHaveBeenCalledWith(tab.id, { saveAs: true, optimize: true });
  });
});

describe('the main menu', () => {
  const item = (label) => [...document.querySelectorAll('#mainMenu .menu-item')].find((el) => el.querySelector('.menu-label').textContent === label);
  const section = () => {
    const head = [...document.querySelectorAll('#mainMenu .menu-head')].find((el) => el.textContent === 'Document');
    const labels = [];
    for (let el = head.nextElementSibling; el && !el.classList.contains('menu-sep'); el = el.nextElementSibling) labels.push(el.querySelector('.menu-label')?.textContent);
    return labels;
  };

  beforeEach(() => {
    document.body.innerHTML = body;
    tools.initDocumentTools();
  });

  it('has a Document section between the file and the app actions', () => {
    expect(section()[0]).toBe('Organize pages');
    expect(section()).toEqual(expect.arrayContaining(['Insert pages from file…', 'Split into files…', 'Protect with password…', 'Remove password…', 'Save optimized copy…', 'Properties…']));
    expect(item('Print…').querySelector('.keys').dataset.shortcut).toBe('print');
    expect(item('Revert to saved…')).toBeTruthy();
  });

  it('enables what applies to the document', () => {
    const tab = makeTab();
    tools.syncDocumentMenu();
    expect(item('Remove password…').disabled).toBe(true);
    expect(item('Revert to saved…').disabled).toBe(true);
    expect(item('Split into files…').disabled).toBe(false);

    tab.password = 'pw';
    tab.modified = true;
    tools.syncDocumentMenu();
    expect(item('Change password…')).toBeTruthy();
    expect(item('Remove password…').disabled).toBe(false);
    expect(item('Revert to saved…').disabled).toBe(false);
  });

  it('without a loaded document everything is off', () => {
    makeTab({ pdfDocument: null });
    tools.syncDocumentMenu();
    for (const label of ['Print…', 'Split into files…', 'Properties…']) expect(item(label).disabled).toBe(true);
  });

  it('runs the action for the active tab', async () => {
    const tab = makeTab();
    item('Print…').click();
    expect(printTab).toHaveBeenCalledWith(tab);
  });
});

describe('palette commands', () => {
  it('offers the document tools that apply, in the Document group', () => {
    const labels = (tab) => tools.documentCommands(tab).map((c) => c.label);
    const tab = makeTab();
    expect(tools.documentCommands(tab).every((c) => c.group === 'Document')).toBe(true);
    expect(labels(tab)).toEqual(['Print…', 'Insert pages from file…', 'Split into files…', 'Protect with password…', 'Save optimized copy…', 'Properties…']);
    tab.password = 'pw';
    tab.modified = true;
    expect(labels(tab)).toEqual(['Revert to saved…', 'Print…', 'Insert pages from file…', 'Split into files…', 'Change password…', 'Remove password…', 'Save optimized copy…', 'Properties…']);
    expect(tools.documentCommands(tab).find((c) => c.label === 'Print…').shortcut).toBe('print');
  });
});
