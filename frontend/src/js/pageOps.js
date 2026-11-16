import { PDFService, SignatureService } from './backend.js';
import { reloadTab, pushWorkingCopy, exportBytes, hasUnsavedEdits, refreshDirty } from './documents.js';
import { showConfirm, showDialog, showMessage } from './messageDialog.js';
import { updateStatus, sanitizeError } from './utils.js';
import { tabLabel } from './tabStrip.js';

// Engines, measured on a PDF with outlines, AcroForm fields and annotations:
// pdf.js 6.5's extractPages (its PDFEditor) keeps all three, remapped to the
// new page order, so delete, move, duplicate, extract, split and
// insert-from-file use it. pdfcpu's page extraction drops the outlines, but
// its rotate, insert-blank and metadata edits change the document in place
// and keep everything, so those run in Go. Either way the result is a working
// copy until saved.

/** The selection after clicking page with ctrl/shift held; anchor is where shift ranges start. */
export function nextSelection(selection, anchor, page, { ctrl = false, shift = false } = {}) {
    if (shift) {
        const from = anchor ?? page;
        const range = new Set(ctrl ? selection : []);
        for (let p = Math.min(from, page); p <= Math.max(from, page); p++) range.add(p);
        return { selection: range, anchor: from };
    }
    if (ctrl) {
        const toggled = new Set(selection);
        if (toggled.has(page)) toggled.delete(page);
        else toggled.add(page);
        return { selection: toggled, anchor: page };
    }
    return { selection: new Set([page]), anchor: page };
}

const sortedPages = (pages) => [...new Set(pages)].sort((a, b) => a - b);

/**
 * Moves pages (1-based) of an n-page document to gap, the slot before page
 * gap+1 of the current order (0 = front, n = end). Returns the new order (old
 * page numbers) and the moved pages' new numbers, or null if nothing moves.
 */
export function moveOrder(n, pages, gap) {
    const moving = sortedPages(pages);
    if (moving.length === 0) return null;
    const rest = [];
    for (let p = 1; p <= n; p++) if (!moving.includes(p)) rest.push(p);
    const at = gap - moving.filter((p) => p <= gap).length;
    const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    if (order.every((p, i) => p === i + 1)) return null;
    return { order, moved: moving.map((_, i) => at + i + 1) };
}

/** pdf.js' pageIndices for an order: the new 0-based index of each page, in file order. */
export function pageIndicesFor(order) {
    const indices = new Array(order.length);
    order.forEach((page, i) => { indices[page - 1] = i; });
    return indices;
}

/**
 * pdf.js pageInfos that copy pages (1-based) of an n-page document, in page
 * order, right after the last of them. copies are the copies' new numbers.
 */
export function duplicateInfos(n, pages) {
    const copying = sortedPages(pages);
    const last = copying.at(-1);
    const k = copying.length;
    return {
        infos: [
            { document: null, pageIndices: Array.from({ length: n }, (_, i) => (i < last ? i : i + k)) },
            { document: null, includePages: copying.map((p) => p - 1), pageIndices: copying.map((_, i) => last + i) }
        ],
        copies: copying.map((_, i) => last + i + 1)
    };
}

/**
 * Parses what Split asks for: a page count ("2": files of 2 pages) or ranges
 * ("1-3, 4, 6-5"). Returns lists of 1-based pages; throws with a message.
 */
export function parseSplitRanges(text, n) {
    const value = text.trim();
    if (/^\d+$/.test(value)) {
        const size = Number(value);
        if (size < 1) throw new Error('The number of pages per file must be at least 1.');
        const ranges = [];
        for (let start = 1; start <= n; start += size) {
            ranges.push(Array.from({ length: Math.min(size, n - start + 1) }, (_, i) => start + i));
        }
        return ranges;
    }
    const ranges = value.split(',').map((part) => {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
        if (!m) throw new Error(`“${part.trim()}” is not a page or a range like 3-5.`);
        const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
        const [from, to] = [Math.min(a, b), Math.max(a, b)];
        if (from < 1 || to > n) throw new Error(`Pages ${part.trim()} are outside 1–${n}.`);
        return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    });
    if (ranges.length === 0) throw new Error('Enter a page count or page ranges.');
    return ranges;
}

/** The pages a page action works on: the selection, else the current page. */
export function targetPages(tab) {
    return sortedPages(tab.selection?.size ? [...tab.selection] : [tab.currentPage]);
}

/** Ctrl+Z undoes a page operation when the pdf.js editor has nothing of its own to undo. */
export function shouldUndoPageOp(tab) {
    return Boolean(tab?.pdfDocument && tab.undoSteps > 0 && !tab.editingState?.hasSomethingToUndo);
}

/** Ctrl+Shift+Z redoes a page operation when the pdf.js editor has nothing of its own to redo. */
export function shouldRedoPageOp(tab) {
    return Boolean(tab?.pdfDocument && tab.redoSteps > 0 && !tab.editingState?.hasSomethingToRedo);
}

/**
 * Who signed the tab's file, when changing its pages would break their
 * signatures: the signer names ([] when it is signed but they can't be read),
 * or null when nothing would break. A tab with unsaved page operations shows
 * a copy whose signatures are already broken. Uses the signatures the Info
 * panel checked, else checks them offline.
 */
export async function signaturesBrokenBy(tab) {
    if (tab.modified) return null;
    let signatures = tab.signatures;
    if (!signatures) {
        try {
            signatures = (await SignatureService.VerifySignaturesOffline(tab.filePath)) ?? [];
        } catch (error) {
            // A protected file can't be checked without its password; pdf.js still knows it is signed.
            console.error('Checking signatures failed:', error);
            return tab.signed ? [] : null;
        }
    }
    if (!signatures.length) return null;
    return signatures.map((sig) => sig.signerName || 'an unknown signer');
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * Before the first page change to a signed document, warns whose signatures
 * it breaks. change says what the change is, for one not to the pages.
 * Resolves true to go ahead; Cancel, the focused default, and Escape resolve
 * false.
 */
export async function confirmSignedChange(tab, { change = 'Changing its pages' } = {}) {
    const signers = await signaturesBrokenBy(tab);
    if (!signers) return true;
    const who = signers.length
        ? `the ${signers.length === 1 ? 'signature' : 'signatures'} of ${listFormat.format([...new Set(signers)])}`
        : 'its signatures';
    return showDialog({
        title: 'Change a signed document?',
        message: `“${tabLabel(tab.fileName)}” is signed. ${change} breaks ${who}. To keep the signed file, save the changed copy with Save\u00A0as… under another name.`,
        tone: 'warning',
        actions: [
            { label: 'Cancel', value: false },
            { label: 'Change anyway', value: true, kind: 'danger' }
        ],
        dismissValue: false,
        focus: false
    });
}

/** The bytes pdf.js builds from pageInfos (see PDFDocumentProxy.extractPages), unsaved edits included. */
export async function rebuild(tab, pageInfos) {
    const bytes = await tab.pdfDocument.extractPages(pageInfos);
    if (!bytes) throw new Error('pdf.js could not rebuild the document.');
    return bytes;
}

/**
 * Runs one page operation on a tab: produce() makes the new working copy and
 * resolves Go's document; the tab then reloads showing page with selection
 * selected. confirmed: the caller already warned about a signed document.
 * Resolves true when the tab changed.
 */
export async function runPageOp(tab, label, produce, { page, selection = [], confirmed = false } = {}) {
    if (!tab?.pdfDocument || tab.busy) return false;
    tab.busy = true;
    try {
        if (!confirmed && !(await confirmSignedChange(tab))) return false;
        updateStatus(`${label}…`);
        // Unsaved form and annotation edits become a working copy of their
        // own, so the operation builds on them and undo comes back to them.
        const based = hasUnsavedEdits(tab);
        if (based) takeWorkState(tab, await pushWorkingCopy(tab, await tab.pdfDocument.saveDocument()));
        let doc;
        try {
            doc = await produce();
        } catch (error) {
            // Left behind, the edits' copy would count as a page change, and a
            // signed file would no longer be warned about.
            if (based) {
                await PDFService.DropPageOp(tab.docId).then((dropped) => takeWorkState(tab, dropped),
                    (err) => console.error('Taking back the copy of the edits failed:', err));
            }
            throw error;
        }
        tab.selection = new Set(selection);
        tab.selectionAnchor = selection[0] ?? null;
        await reloadTab(tab, { page, doc });
        updateStatus(`${label}: done (unsaved, Ctrl+Z undoes it)`);
        return true;
    } catch (error) {
        console.error(`${label} failed:`, error);
        refreshDirty(tab);
        updateStatus(`${label} failed`);
        await showMessage(sanitizeError(error), `Lankir couldn’t ${label.toLowerCase()}`, 'error');
        return false;
    } finally {
        tab.busy = false;
    }
}

function takeWorkState(tab, doc) {
    tab.modified = doc.modified;
    tab.undoSteps = doc.undoSteps;
    tab.redoSteps = doc.redoSteps ?? 0;
}

/** Rotates pages (default: the target pages) clockwise by degrees (±90, 180). */
export function rotatePages(tab, degrees, pages = targetPages(tab)) {
    return runPageOp(tab, 'Rotate pages', () => PDFService.RotatePages(tab.docId, pages, degrees), { page: tab.currentPage, selection: pages });
}

/** Deletes pages (default: the target pages), asking first for more than one; never all of them. */
export async function deletePages(tab, pages = targetPages(tab)) {
    if (!tab?.pdfDocument) return false;
    if (pages.length >= tab.totalPages) {
        await showMessage('A document needs at least one page. Select fewer pages to delete.', 'Can’t delete every page', 'warning');
        return false;
    }
    if (pages.length > 1 && !(await showConfirm(`Delete ${pages.length} pages from “${tab.fileName}”?`, 'Delete pages', { confirmLabel: 'Delete', danger: true }))) return false;
    const keep = [];
    for (let p = 1; p <= tab.totalPages; p++) if (!pages.includes(p)) keep.push(p - 1);
    return runPageOp(tab, 'Delete pages', async () => pushWorkingCopy(tab, await rebuild(tab, [{ document: null, includePages: keep }])),
        { page: Math.min(pages[0], keep.length) });
}

/** Moves pages (default: the target pages) to gap (see moveOrder). */
export async function movePages(tab, gap, pages = targetPages(tab)) {
    if (!tab?.pdfDocument) return false;
    const move = moveOrder(tab.totalPages, pages, gap);
    if (!move) return false;
    const pageIndices = pageIndicesFor(move.order);
    return runPageOp(tab, 'Move pages', async () => pushWorkingCopy(tab, await rebuild(tab, [{ document: null, pageIndices }])),
        { page: move.moved[0], selection: move.moved });
}

/** Copies pages (default: the target pages) right after the last of them and selects the copies. */
export async function duplicatePages(tab, pages = targetPages(tab)) {
    if (!tab?.pdfDocument || pages.length === 0) return false;
    const { infos, copies } = duplicateInfos(tab.totalPages, pages);
    return runPageOp(tab, 'Duplicate pages', async () => pushWorkingCopy(tab, await rebuild(tab, infos)),
        { page: copies[0], selection: copies });
}

/** Inserts a blank page, sized like its neighbour, after the last of pages (default: the target pages). */
export function insertBlankPage(tab, pages = targetPages(tab)) {
    const after = pages.at(-1);
    return runPageOp(tab, 'Insert a blank page', () => PDFService.InsertBlankPage(tab.docId, after), { page: after + 1, selection: [after + 1] });
}

/** Writes pages (default: the target pages) to a new file chosen in a Save dialog. */
export async function extractPages(tab, pages = targetPages(tab)) {
    if (!tab?.pdfDocument || tab.busy) return false;
    try {
        const target = await PDFService.ChooseSavePath(tab.docId, `${baseName(tab)}_pages.pdf`);
        if (!target) return false;
        if (target.exists && !(await showConfirm('A file with that name already exists in the folder. Replacing it overwrites its contents.',
            `Replace “${target.path.split(/[/\\]/).pop()}”?`, { confirmLabel: 'Replace', danger: true }))) return false;
        tab.busy = true;
        updateStatus('Extracting pages…');
        await exportBytes(tab, target.path, await rebuild(tab, [{ document: null, includePages: pages.map((p) => p - 1) }]), target.exists);
        updateStatus(`Extracted ${pages.length} page${pages.length === 1 ? '' : 's'} to ${target.path}`);
        return true;
    } catch (error) {
        console.error('Extract failed:', error);
        updateStatus('Extract failed');
        await showMessage(sanitizeError(error), 'Lankir couldn’t extract the pages', 'error');
        return false;
    } finally {
        tab.busy = false;
    }
}

/** Takes back the last count page operations (at most what can be undone), with one reload. */
export function undoPageOp(tab, count = 1) {
    return stepPageOps(tab, Math.min(count, tab?.undoSteps ?? 0), {
        call: PDFService.UndoPageOp,
        ask: 'Undoing the last page change also discards the form and annotation changes made after it.',
        title: 'Undo the last page change?',
        action: 'Undo',
        done: count > 1 ? 'Undid the page changes' : 'Undid the last page change'
    });
}

/** Brings back the page operation undo last took back. */
export function redoPageOp(tab) {
    return stepPageOps(tab, Math.min(1, tab?.redoSteps ?? 0), {
        call: PDFService.RedoPageOp,
        ask: 'Redoing the page change discards the form and annotation changes made since the undo.',
        title: 'Redo the page change?',
        action: 'Redo',
        done: 'Redid the page change'
    });
}

async function stepPageOps(tab, count, { call, ask, title, action, done }) {
    if (!tab?.pdfDocument || tab.busy || !(count > 0)) return false;
    if (hasUnsavedEdits(tab) && !(await showConfirm(ask, title, { confirmLabel: action, danger: true }))) return false;
    tab.busy = true;
    try {
        let doc;
        for (let i = 0; i < count; i++) doc = await call(tab.docId);
        tab.selection = new Set();
        await reloadTab(tab, { doc });
        updateStatus(done);
        return true;
    } catch (error) {
        console.error(`${action} failed:`, error);
        await showMessage(sanitizeError(error), `Lankir couldn’t ${action.toLowerCase()}`, 'error');
        return false;
    } finally {
        tab.busy = false;
    }
}

/** The tab's file name without .pdf, for naming derived files. */
export function baseName(tab) {
    return tab.fileName.replace(/\.pdf$/i, '');
}
