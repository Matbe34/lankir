import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFService, SignatureService } from '../src/js/backend.js';

const showConfirm = vi.fn();
const showMessage = vi.fn(() => Promise.resolve());
const showDialog = vi.fn();
vi.mock('../src/js/messageDialog.js', () => ({
  showConfirm: (...a) => showConfirm(...a),
  showMessage: (...a) => showMessage(...a),
  showDialog: (...a) => showDialog(...a),
  showChoice: vi.fn(),
  showPrompt: vi.fn()
}));

// documents.js talks to Go and pdf.js; these stand in with the same contract.
const reloadTab = vi.fn(async (tab, { doc } = {}) => {
  if (doc) {
    tab.modified = doc.modified;
    tab.undoSteps = doc.undoSteps;
  }
  tab.savedHash = tab.storageHash();
});
const pushWorkingCopy = vi.fn(async () => ({ modified: true, undoSteps: 1 }));
const exportBytes = vi.fn(async () => ({}));
vi.mock('../src/js/documents.js', () => ({
  reloadTab: (...a) => reloadTab(...a),
  pushWorkingCopy: (...a) => pushWorkingCopy(...a),
  exportBytes: (...a) => exportBytes(...a),
  hasUnsavedEdits: (tab) => tab.storageHash() !== tab.savedHash,
  refreshDirty: vi.fn()
}));

const ops = await import('../src/js/pageOps.js');

// A tab whose pdf.js document rebuilds itself like PDFDocumentProxy.extractPages:
// it returns the new file's bytes (null when pdf.js fails) and includes the
// annotation storage's unsaved edits.
function makeTab(pages = 5, fields = {}) {
  const storage = new Map();
  const tab = {
    id: 1,
    docId: 'doc-1',
    fileName: 'report.pdf',
    filePath: '/docs/report.pdf',
    totalPages: pages,
    currentPage: 1,
    selection: new Set(),
    modified: false,
    undoSteps: 0,
    signed: false,
    editingState: {},
    savedHash: '[]',
    storageHash: () => JSON.stringify([...storage]),
    storage,
    pdfDocument: {
      numPages: pages,
      extractPages: vi.fn(async (infos) => new TextEncoder().encode(JSON.stringify({ infos, edits: [...storage] }))),
      saveDocument: vi.fn(async () => new TextEncoder().encode('saved' + JSON.stringify([...storage])))
    },
    ...fields
  };
  return tab;
}
const sent = (call) => JSON.parse(new TextDecoder().decode(call));

beforeEach(() => {
  showConfirm.mockReset();
  showDialog.mockReset();
  showMessage.mockClear();
  SignatureService.VerifySignaturesOffline.mockReset().mockResolvedValue([]);
  reloadTab.mockClear();
  pushWorkingCopy.mockClear();
  exportBytes.mockClear();
});

describe('thumbnail selection', () => {
  const click = (sel, anchor, page, mods = {}) => ops.nextSelection(new Set(sel), anchor, page, mods);

  it('a plain click selects only that page', () => {
    expect(click([1, 2], 1, 4)).toEqual({ selection: new Set([4]), anchor: 4 });
  });

  it('ctrl-click toggles a page and moves the anchor', () => {
    expect(click([1, 2], 1, 4, { ctrl: true })).toEqual({ selection: new Set([1, 2, 4]), anchor: 4 });
    expect(click([1, 2], 1, 2, { ctrl: true })).toEqual({ selection: new Set([1]), anchor: 2 });
  });

  it('shift-click selects the range from the anchor, ctrl+shift adds it', () => {
    expect(click([2], 2, 5, { shift: true })).toEqual({ selection: new Set([2, 3, 4, 5]), anchor: 2 });
    expect(click([2], 5, 3, { shift: true })).toEqual({ selection: new Set([3, 4, 5]), anchor: 5 });
    expect(click([1], 4, 5, { shift: true, ctrl: true })).toEqual({ selection: new Set([1, 4, 5]), anchor: 4 });
  });

  it('shift-click without an anchor starts at the clicked page', () => {
    expect(click([], null, 3, { shift: true })).toEqual({ selection: new Set([3]), anchor: 3 });
  });
});

describe('reorder index math', () => {
  it('moves pages into the gap before a page, counting the gap in the original list', () => {
    // Gap 0 is before page 1, gap n after the last page.
    expect(ops.moveOrder(5, [4], 1)).toEqual({ order: [1, 4, 2, 3, 5], moved: [2] });
    expect(ops.moveOrder(5, [1, 2], 4)).toEqual({ order: [3, 4, 1, 2, 5], moved: [3, 4] });
    expect(ops.moveOrder(5, [2, 5], 0)).toEqual({ order: [2, 5, 1, 3, 4], moved: [1, 2] });
    expect(ops.moveOrder(5, [1, 3], 5)).toEqual({ order: [2, 4, 5, 1, 3], moved: [4, 5] });
  });

  it('is null when nothing would move', () => {
    expect(ops.moveOrder(5, [2], 2)).toBeNull();
    expect(ops.moveOrder(5, [2], 1)).toBeNull();
    expect(ops.moveOrder(5, [2, 3], 3)).toBeNull();
    expect(ops.moveOrder(5, [], 3)).toBeNull();
  });

  it('gives pdf.js the new index of each page in file order', () => {
    expect(ops.pageIndicesFor([3, 1, 2])).toEqual([1, 2, 0]);
    expect(ops.pageIndicesFor([1, 4, 2, 3, 5])).toEqual([0, 2, 3, 1, 4]);
  });
});

describe('split ranges', () => {
  it('splits every N pages', () => {
    expect(ops.parseSplitRanges('2', 5)).toEqual([[1, 2], [3, 4], [5]]);
    expect(ops.parseSplitRanges(' 5 ', 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('takes custom ranges', () => {
    expect(ops.parseSplitRanges('1-2, 3, 5-4', 5)).toEqual([[1, 2], [3], [4, 5]]);
  });

  it('rejects bad input with a message', () => {
    for (const bad of ['', '0', 'x', '1-9', '2-', '1,,2', '0-1']) {
      expect(() => ops.parseSplitRanges(bad, 5), bad).toThrow();
    }
  });
});

describe('deleting pages', () => {
  it('never deletes every page', async () => {
    const tab = makeTab(3, { selection: new Set([1, 2, 3]) });
    expect(await ops.deletePages(tab)).toBe(false);
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('at least one page'), expect.any(String), 'warning');
    expect(tab.pdfDocument.extractPages).not.toHaveBeenCalled();
  });

  it('asks before deleting more than one page', async () => {
    const tab = makeTab(5, { selection: new Set([2, 4]) });
    showConfirm.mockResolvedValueOnce(false);
    expect(await ops.deletePages(tab)).toBe(false);
    expect(tab.pdfDocument.extractPages).not.toHaveBeenCalled();

    showConfirm.mockResolvedValueOnce(true);
    expect(await ops.deletePages(tab)).toBe(true);
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([{ document: null, includePages: [0, 2, 4] }]);
    expect(pushWorkingCopy).toHaveBeenCalledTimes(1);
    expect(reloadTab).toHaveBeenCalledWith(tab, expect.objectContaining({ page: 2, doc: { modified: true, undoSteps: 1 } }));
    expect(tab.modified).toBe(true);
    expect(tab.selection.size).toBe(0);
  });

  it('deletes one page without asking', async () => {
    const tab = makeTab(5, { selection: new Set([5]) });
    expect(await ops.deletePages(tab)).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([{ document: null, includePages: [0, 1, 2, 3] }]);
  });

  it('reports a pdf.js failure and leaves the tab alone', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    tab.pdfDocument.extractPages.mockResolvedValueOnce(null);
    expect(await ops.deletePages(tab)).toBe(false);
    expect(showMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'error');
    expect(reloadTab).not.toHaveBeenCalled();
  });
});

describe('unsaved edits and undo', () => {
  it('folds unsaved annotation edits into a working copy first so undo returns to them', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    tab.storage.set('field', 'x');

    expect(await ops.deletePages(tab)).toBe(true);
    expect(pushWorkingCopy).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(pushWorkingCopy.mock.calls[0][1])).toBe('saved[["field","x"]]');
    expect(sent(pushWorkingCopy.mock.calls[1][1]).edits).toEqual([['field', 'x']]);
  });

  it('drops the copy of the edits when the operation fails, without a redo step, so a signed file is still warned about', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    tab.storage.set('field', 'x');
    PDFService.RotatePages.mockRejectedValueOnce(new Error('pdfcpu failed'));
    PDFService.DropPageOp.mockResolvedValueOnce({ modified: false, undoSteps: 0, redoSteps: 0 });

    expect(await ops.rotatePages(tab, 90)).toBe(false);
    expect(pushWorkingCopy).toHaveBeenCalledTimes(1);
    expect(PDFService.DropPageOp).toHaveBeenCalledWith('doc-1');
    expect(PDFService.UndoPageOp).not.toHaveBeenCalled();
    expect(tab.modified).toBe(false);
    expect(tab.undoSteps).toBe(0);
    expect(tab.redoSteps).toBe(0);
    expect(reloadTab).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('pdfcpu failed'), expect.any(String), 'error');

    // Without edits nothing was pushed, so nothing is taken back.
    PDFService.DropPageOp.mockClear();
    tab.storage.clear();
    PDFService.RotatePages.mockRejectedValueOnce(new Error('pdfcpu failed'));
    expect(await ops.rotatePages(tab, 90)).toBe(false);
    expect(PDFService.DropPageOp).not.toHaveBeenCalled();
  });

  it('routes Ctrl+Z to page undo only when pdf.js has nothing to undo', () => {
    expect(ops.shouldUndoPageOp(makeTab(3, { undoSteps: 1 }))).toBe(true);
    expect(ops.shouldUndoPageOp(makeTab(3, { undoSteps: 0 }))).toBe(false);
    expect(ops.shouldUndoPageOp(makeTab(3, { undoSteps: 2, editingState: { hasSomethingToUndo: true } }))).toBe(false);
    expect(ops.shouldUndoPageOp(null)).toBe(false);
  });

  it('undo drops the newest working copy and reloads', async () => {
    const tab = makeTab(5, { modified: true, undoSteps: 1 });
    PDFService.UndoPageOp.mockResolvedValueOnce({ modified: false, undoSteps: 0 });
    expect(await ops.undoPageOp(tab)).toBe(true);
    expect(PDFService.UndoPageOp).toHaveBeenCalledWith('doc-1');
    expect(reloadTab).toHaveBeenCalledWith(tab, { doc: { modified: false, undoSteps: 0 } });
    expect(tab.modified).toBe(false);
  });

  it('asks before undo throws away form edits made since', async () => {
    const tab = makeTab(5, { modified: true, undoSteps: 1 });
    tab.storage.set('field', 'typed');
    showConfirm.mockResolvedValueOnce(false);
    expect(await ops.undoPageOp(tab)).toBe(false);
    expect(PDFService.UndoPageOp).not.toHaveBeenCalled();
  });

  it('does nothing with nothing to undo', async () => {
    expect(await ops.undoPageOp(makeTab(5))).toBe(false);
    expect(PDFService.UndoPageOp).not.toHaveBeenCalled();
  });

  it('undoes several page changes with one reload', async () => {
    const tab = makeTab(5, { modified: true, undoSteps: 3 });
    PDFService.UndoPageOp
      .mockResolvedValueOnce({ modified: true, undoSteps: 2, redoSteps: 1 })
      .mockResolvedValueOnce({ modified: true, undoSteps: 1, redoSteps: 2 })
      .mockResolvedValueOnce({ modified: false, undoSteps: 0, redoSteps: 3 });
    expect(await ops.undoPageOp(tab, 3)).toBe(true);
    expect(PDFService.UndoPageOp).toHaveBeenCalledTimes(3);
    expect(reloadTab).toHaveBeenCalledTimes(1);
    expect(reloadTab).toHaveBeenCalledWith(tab, { doc: { modified: false, undoSteps: 0, redoSteps: 3 } });
  });

  it('redo brings back the last undone change and reloads', async () => {
    const tab = makeTab(5, { modified: false, undoSteps: 0, redoSteps: 1 });
    PDFService.RedoPageOp.mockResolvedValueOnce({ modified: true, undoSteps: 1, redoSteps: 0 });
    expect(await ops.redoPageOp(tab)).toBe(true);
    expect(PDFService.RedoPageOp).toHaveBeenCalledWith('doc-1');
    expect(reloadTab).toHaveBeenCalledWith(tab, { doc: { modified: true, undoSteps: 1, redoSteps: 0 } });
  });

  it('does nothing with nothing to redo, and asks before redo throws away form edits', async () => {
    expect(await ops.redoPageOp(makeTab(5))).toBe(false);
    const tab = makeTab(5, { redoSteps: 1 });
    tab.storage.set('field', 'typed');
    showConfirm.mockResolvedValueOnce(false);
    expect(await ops.redoPageOp(tab)).toBe(false);
    expect(PDFService.RedoPageOp).not.toHaveBeenCalled();
  });

  it('routes Ctrl+Shift+Z to page redo only when pdf.js has nothing to redo', () => {
    expect(ops.shouldRedoPageOp(makeTab(3, { redoSteps: 1 }))).toBe(true);
    expect(ops.shouldRedoPageOp(makeTab(3, { redoSteps: 0 }))).toBe(false);
    expect(ops.shouldRedoPageOp(makeTab(3, { redoSteps: 1, editingState: { hasSomethingToRedo: true } }))).toBe(false);
    expect(ops.shouldRedoPageOp(null)).toBe(false);
  });
});

describe('signed documents', () => {
  const ALICE = { signerName: 'Alice Martí', isValid: true };
  const BOB = { signerName: 'Bob Puig', isValid: true };

  it('names whose signatures a change breaks, from the signatures the Info panel checked', async () => {
    const tab = makeTab(5, { signed: true, signatures: [ALICE, BOB] });
    expect(await ops.signaturesBrokenBy(tab)).toEqual(['Alice Martí', 'Bob Puig']);
    expect(SignatureService.VerifySignaturesOffline).not.toHaveBeenCalled();
  });

  it('checks the signatures offline when the Info panel has not', async () => {
    SignatureService.VerifySignaturesOffline.mockResolvedValueOnce([ALICE, { signerName: '' }]);
    const tab = makeTab(5, { signed: true });
    expect(await ops.signaturesBrokenBy(tab)).toEqual(['Alice Martí', 'an unknown signer']);
    expect(SignatureService.VerifySignaturesOffline).toHaveBeenCalledWith('/docs/report.pdf');
  });

  it('breaks nothing in an unsigned file or a copy already changed', async () => {
    expect(await ops.signaturesBrokenBy(makeTab(5, { signatures: [] }))).toBeNull();
    expect(await ops.signaturesBrokenBy(makeTab(5))).toBeNull();
    expect(await ops.signaturesBrokenBy(makeTab(5, { signed: true, signatures: [ALICE], modified: true }))).toBeNull();
  });

  it('still warns about a signed file whose signatures could not be read', async () => {
    SignatureService.VerifySignaturesOffline.mockRejectedValueOnce(new Error('encrypted'));
    expect(await ops.signaturesBrokenBy(makeTab(5, { signed: true }))).toEqual([]);
    SignatureService.VerifySignaturesOffline.mockRejectedValueOnce(new Error('encrypted'));
    expect(await ops.signaturesBrokenBy(makeTab(5))).toBeNull();
  });

  it('the warning names the signers and defaults to Cancel', async () => {
    showDialog.mockResolvedValueOnce(false);
    const tab = makeTab(5, { signed: true, signatures: [ALICE, BOB] });
    expect(await ops.confirmSignedChange(tab)).toBe(false);
    const dialog = showDialog.mock.calls[0][0];
    expect(dialog.title).toBe('Change a signed document?');
    expect(dialog.message).toBe('“report” is signed. Changing its pages breaks the signatures of Alice Martí and Bob Puig. '
      + 'To keep the signed file, save the changed copy with Save\u00A0as… under another name.');
    expect(dialog.tone).toBe('warning');
    expect(dialog.dismissValue).toBe(false);
    expect(dialog.focus).toBe(false);
    expect(dialog.actions).toEqual([
      { label: 'Cancel', value: false },
      expect.objectContaining({ value: true, kind: 'danger' })
    ]);
  });

  it('warns once before the first change and stops when declined', async () => {
    const tab = makeTab(5, { signed: true, signatures: [ALICE], selection: new Set([1]) });
    showDialog.mockResolvedValueOnce(false);
    expect(await ops.rotatePages(tab, 90)).toBe(false);
    expect(showDialog.mock.calls[0][0].message).toContain('signature of Alice Martí');
    expect(PDFService.RotatePages).not.toHaveBeenCalled();

    showDialog.mockResolvedValueOnce(true);
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    expect(await ops.rotatePages(tab, 90)).toBe(true);

    // The working copy's signatures are already broken: no second warning.
    showDialog.mockClear();
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 2 });
    expect(await ops.rotatePages(tab, 90)).toBe(true);
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('names the change when it is not to the pages', async () => {
    showDialog.mockResolvedValueOnce(true);
    await ops.confirmSignedChange(makeTab(5, { signed: true, signatures: [ALICE] }), { change: 'Protecting it with a password' });
    expect(showDialog.mock.calls[0][0].message).toContain(' Protecting it with a password breaks the signature of Alice Martí. ');
  });

  it('an operation the caller already confirmed is not warned about again', async () => {
    const tab = makeTab(5, { signed: true, signatures: [ALICE] });
    expect(await ops.runPageOp(tab, 'Insert pages', async () => ({ modified: true, undoSteps: 1 }), { confirmed: true })).toBe(true);
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('does not warn for unsigned documents', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    expect(await ops.rotatePages(tab, -90)).toBe(true);
    expect(showDialog).not.toHaveBeenCalled();
  });
});

describe('page operations', () => {
  it('rotates the selected pages in Go and keeps them selected', async () => {
    const tab = makeTab(5, { selection: new Set([4, 2]) });
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    expect(await ops.rotatePages(tab, -90)).toBe(true);
    expect(PDFService.RotatePages).toHaveBeenCalledWith('doc-1', [2, 4], -90);
    expect([...tab.selection]).toEqual([2, 4]);
  });

  it('acts on the current page when nothing is selected', async () => {
    const tab = makeTab(5, { currentPage: 3 });
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    await ops.rotatePages(tab, 90);
    expect(PDFService.RotatePages).toHaveBeenCalledWith('doc-1', [3], 90);
  });

  it('moves the selection with pdf.js and selects the pages at their new place', async () => {
    const tab = makeTab(5, { selection: new Set([4, 5]) });
    expect(await ops.movePages(tab, 0)).toBe(true);
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([{ document: null, pageIndices: [2, 3, 4, 0, 1] }]);
    expect([...tab.selection]).toEqual([1, 2]);
    expect(reloadTab).toHaveBeenCalledWith(tab, expect.objectContaining({ page: 1 }));
  });

  it('does nothing when a move changes no order', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    expect(await ops.movePages(tab, 0)).toBe(false);
    expect(tab.pdfDocument.extractPages).not.toHaveBeenCalled();
  });

  it('duplicates the selection after its last page with pdf.js and selects the copies', async () => {
    const tab = makeTab(5, { selection: new Set([4, 2]) });
    expect(await ops.duplicatePages(tab)).toBe(true);
    // New order: 1 2 3 4 2' 4' 5.
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([
      { document: null, pageIndices: [0, 1, 2, 3, 6] },
      { document: null, includePages: [1, 3], pageIndices: [4, 5] }
    ]);
    expect(pushWorkingCopy).toHaveBeenCalledTimes(1);
    expect([...tab.selection]).toEqual([5, 6]);
    expect(reloadTab).toHaveBeenCalledWith(tab, expect.objectContaining({ page: 5 }));
  });

  it('duplicates given pages, the last page too', async () => {
    const tab = makeTab(3, { selection: new Set([1]) });
    expect(await ops.duplicatePages(tab, [3])).toBe(true);
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([
      { document: null, pageIndices: [0, 1, 2] },
      { document: null, includePages: [2], pageIndices: [3] }
    ]);
    expect([...tab.selection]).toEqual([4]);
  });

  it('acts on given pages instead of the selection', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    PDFService.RotatePages.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    await ops.rotatePages(tab, 180, [5]);
    expect(PDFService.RotatePages).toHaveBeenCalledWith('doc-1', [5], 180);
  });

  it('inserts a blank page after the last selected page and selects it', async () => {
    const tab = makeTab(5, { selection: new Set([2, 3]) });
    PDFService.InsertBlankPage.mockResolvedValueOnce({ modified: true, undoSteps: 1 });
    expect(await ops.insertBlankPage(tab)).toBe(true);
    expect(PDFService.InsertBlankPage).toHaveBeenCalledWith('doc-1', 3);
    expect([...tab.selection]).toEqual([4]);
  });

  it('extracts the selection to a new file without changing the tab', async () => {
    const tab = makeTab(5, { selection: new Set([3, 1]) });
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/out/x.pdf', exists: false });
    expect(await ops.extractPages(tab)).toBe(true);
    expect(PDFService.ChooseSavePath).toHaveBeenCalledWith('doc-1', 'report_pages.pdf');
    expect(tab.pdfDocument.extractPages).toHaveBeenCalledWith([{ document: null, includePages: [0, 2] }]);
    expect(exportBytes).toHaveBeenCalledWith(tab, '/out/x.pdf', expect.any(Uint8Array), false);
    expect(reloadTab).not.toHaveBeenCalled();
    expect(pushWorkingCopy).not.toHaveBeenCalled();
  });

  it('asks before extracting over an existing file', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/out/x.pdf', exists: true });
    showConfirm.mockResolvedValueOnce(false);
    expect(await ops.extractPages(tab)).toBe(false);
    expect(exportBytes).not.toHaveBeenCalled();
  });

  it('ignores a second operation while one runs', async () => {
    const tab = makeTab(5, { selection: new Set([1]) });
    let finish;
    PDFService.RotatePages.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = ops.rotatePages(tab, 90);
    await vi.waitFor(() => expect(PDFService.RotatePages).toHaveBeenCalled());
    expect(await ops.rotatePages(tab, 90)).toBe(false);
    finish({ modified: true, undoSteps: 1 });
    expect(await first).toBe(true);
  });
});
