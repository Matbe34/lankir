// Document tools: the Document section of the ≡ menu and its Ctrl K
// commands. Insert pages from file, Split into files, Protect or remove the
// password, Save optimized copy, Properties, Print and Revert to saved.
// Page changes run as undoable working copies (see pageOps.js); protection
// is applied on the next save; Split only writes new files.
import { PDFService } from './backend.js';
import { getActivePDF } from './state.js';
import { reloadTab, pushWorkingCopy, exportBytes, exportOptionsFor, hasUnsavedEdits, refreshDirty, saveTab } from './documents.js';
import { runPageOp, rebuild, parseSplitRanges, confirmSignedChange, baseName } from './pageOps.js';
import { showConfirm, showMessage, showPrompt } from './messageDialog.js';
import { loadDocument, PasswordResponses, PDFDateString } from './viewer.js';
import { printTab } from './print.js';
import { showToast } from './toast.js';
import { openDialog, fragment } from './documentDialog.js';
import { iconSvg } from './icons.js';
import { escapeHtml, formatFileSize, middleCut, sanitizeError, updateStatus } from './utils.js';
import { pathMarkup } from './recentFiles.js';

const pagesLabel = (n) => `${n} ${n === 1 ? 'page' : 'pages'}`;
const filesLabel = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;
const homePath = (path) => path.replace(/^\/home\/[^/]+/, '~');
const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });
const formatDay = (date) => date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** True when opening the file asks (or, after the next save, will ask) for a password. */
export const isProtected = (tab) => Boolean(tab.protect ?? tab.password);
const isDirty = (tab) => Boolean(tab.dirty || tab.modified || tab.protect !== undefined);

/* ---------- Split ---------- */

/**
 * The files Split writes: mode 'ranges' takes "1-3, 4, 6-12" (one file
 * each; a lone number is that page), mode 'every' a page count per file.
 * Throws with a message for the field.
 */
export function splitPlan(mode, text, n, base) {
    // A comma typed before the next range is not a mistake yet.
    const value = text.trim().replace(/[,\s]+$/, '');
    let ranges;
    if (mode === 'every') {
        if (!/^\d+$/.test(value)) throw new Error('Enter how many pages each file gets.');
        ranges = parseSplitRanges(value, n);
    } else {
        if (!value) throw new Error('Enter page ranges, like 1-3, 4-12.');
        ranges = parseSplitRanges(/^\d+$/.test(value) ? `${value}-${value}` : value, n);
    }
    return ranges.map((pages, i) => ({ name: `${base}_part${i + 1}.pdf`, pages }));
}

const rangeText = (pages) => (pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages[0]}–${pages.at(-1)}`);
// Pages drawn in the preview's ribbon; a long part shows its ends around a gap.
const RIBBON_BUDGET = 48;
const RIBBON_PART_MAX = 8;

function ribbonPart(file, index) {
    const part = document.createElement('div');
    part.className = 'ribbon-part';
    const pages = document.createElement('div');
    pages.className = 'ribbon-pages';
    const shown = file.pages.length > RIBBON_PART_MAX
        ? [...file.pages.slice(0, 3), null, ...file.pages.slice(-2)]
        : file.pages;
    for (const page of shown) {
        const tile = document.createElement('span');
        tile.className = page === null ? 'ribbon-page is-gap' : 'ribbon-page';
        tile.textContent = page === null ? '…' : String(page);
        pages.append(tile);
    }
    part.append(pages, `Part ${index + 1}`);
    return part;
}

function fileRow(title, sub, pill) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `<span class="list-row-icon">${iconSvg('file-text')}</span>
        <span class="list-row-text"><span class="list-row-title"></span><span class="list-row-sub"></span></span>`;
    row.querySelector('.list-row-title').textContent = title;
    row.querySelector('.list-row-title').dataset.tip = title;
    row.querySelector('.list-row-sub').textContent = sub;
    if (pill) row.append(Object.assign(document.createElement('span'), { className: 'pill', textContent: pill }));
    return row;
}

const joinPath = (dir, name) => {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return dir.replace(/[\\/]$/, '') + sep + name;
};

/** Why writing a part stopped, and what was written before it. */
function splitFailure(error, file, written) {
    const conflict = error.cause?.conflict;
    let text = conflict === 'exists'
        ? `“${file.name}” is already in this folder. Lankir doesn’t replace files: choose another folder, or move that file.`
        : conflict === 'open'
            ? `“${file.name}” is open in Lankir. Close it, or choose another folder.`
            : `Splitting stopped: ${sanitizeError(error)}`;
    if (written.length === 1) text += ` Only “${written[0]}” was written.`;
    else if (written.length > 1) text += ` The first ${written.length} files were written.`;
    return text;
}

/**
 * Splits the document into new files, in a folder chosen in the dialog. It
 * never changes the document, so it asks nothing about signatures. Resolves
 * true when the files were written.
 */
export async function splitDocument(tab) {
    if (!tab?.pdfDocument || tab.busy) return false;
    const n = tab.totalPages;
    const base = baseName(tab);
    const half = Math.ceil(n / 2);
    const range = (a, b) => (a === b ? `${a}` : `${a}-${b}`);
    const values = { ranges: n > 1 ? `${range(1, half)}, ${range(half + 1, n)}` : '1', every: '1' };
    const protectable = isProtected(tab);
    let mode = 'ranges';
    let plan = [];
    let folder = '';

    const body = fragment(`
        <div class="segmented full" role="group" aria-label="Split by">
            <button type="button" class="segment" data-mode="ranges" aria-pressed="true">Page ranges</button>
            <button type="button" class="segment" data-mode="every" aria-pressed="false">Every N pages</button>
        </div>
        <div class="dialog-field">
            <label class="field-label" for="splitRanges" id="splitLabel"></label>
            <input id="splitRanges" class="input" autocomplete="off" spellcheck="false" aria-describedby="splitHint splitError">
            <p class="field-hint" id="splitHint"></p>
            <p class="field-error" id="splitError" role="alert"></p>
        </div>
        <div class="split-preview">
            <h3 class="group-title" id="splitCount"></h3>
            <div class="ribbon" aria-hidden="true"></div>
            <div class="list-box split-files" role="list" aria-labelledby="splitCount"></div>
        </div>
        ${protectable ? `<label class="check-row dialog-check"><input type="checkbox" class="checkbox" id="splitProtect" checked>Protect the new files with the same password</label>` : ''}
        <div class="save-row">
            <span class="save-row-icon">${iconSvg('folder')}</span>
            <span class="save-row-text" id="splitFolder"></span>
            <button type="button" class="btn" id="splitFolderBtn"></button>
        </div>
        <div class="notice danger" id="splitNotice" hidden><span class="notice-icon">${iconSvg('circle-alert', 'icon-sm')}</span><span class="notice-text"></span></div>`);

    const dialog = openDialog({
        id: 'splitDialog',
        title: 'Split into files',
        size: 'md',
        body,
        actions: [{ label: 'Cancel', value: null }, { label: 'Split', value: 'split', kind: 'primary' }],
        onAction: () => writeParts()
    });
    const root = dialog.root;
    const q = (sel) => root.querySelector(sel);
    const input = q('#splitRanges');
    const notice = q('#splitNotice');

    const syncPrimary = () => {
        const valid = plan.length > 0 && !input.hasAttribute('aria-invalid');
        dialog.primary.disabled = !valid || !folder || tab.busy;
        dialog.primary.textContent = plan.length === 1 ? 'Save 1 file' : `Split into ${plan.length} files`;
    };
    const syncFolder = () => {
        const text = q('#splitFolder');
        if (folder) {
            text.innerHTML = `<span class="save-row-label">Save in</span>${pathMarkup(homePath(folder))}`;
            text.dataset.tip = folder;
        } else {
            text.textContent = 'Choose where to save the files';
        }
        text.classList.toggle('is-empty', !folder);
        q('#splitFolderBtn').textContent = folder ? 'Change…' : 'Choose folder…';
    };
    const render = () => {
        values[mode] = input.value;
        try {
            plan = splitPlan(mode, input.value, n, base);
            input.removeAttribute('aria-invalid');
            q('#splitError').textContent = '';
        } catch (error) {
            // The last valid preview stays, dimmed, while the field is fixed.
            input.setAttribute('aria-invalid', 'true');
            q('#splitError').textContent = error.message;
            q('.split-preview').classList.add('is-stale');
            q('#splitHint').hidden = true;
            syncPrimary();
            return;
        }
        q('#splitHint').hidden = false;
        q('.split-preview').classList.remove('is-stale');
        q('#splitCount').textContent = filesLabel(plan.length);
        const ribbon = q('.ribbon');
        ribbon.replaceChildren();
        let budget = RIBBON_BUDGET;
        for (const [i, file] of plan.entries()) {
            if (budget <= 0) {
                ribbon.append(Object.assign(document.createElement('span'), { className: 'ribbon-more', textContent: `+${plan.length - i} more` }));
                break;
            }
            ribbon.append(ribbonPart(file, i));
            budget -= Math.min(file.pages.length, RIBBON_PART_MAX);
        }
        q('.split-files').replaceChildren(...plan.map((file) => fileRow(file.name, rangeText(file.pages))));
        syncPrimary();
    };
    const setMode = (next) => {
        mode = next;
        for (const btn of root.querySelectorAll('[data-mode]')) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
        q('#splitLabel').textContent = mode === 'every' ? 'Pages per file' : 'Ranges, one file each';
        q('#splitHint').textContent = mode === 'every'
            ? `The last file gets the pages left over. The document has ${pagesLabel(n)}.`
            : `Separate ranges with commas. The document has ${pagesLabel(n)}.`;
        input.inputMode = mode === 'every' ? 'numeric' : 'text';
        input.value = values[mode];
        render();
    };

    async function writeParts() {
        notice.hidden = true;
        const options = q('#splitProtect')?.checked ? exportOptionsFor(tab) : exportOptionsFor(tab, { protect: false });
        const written = [];
        tab.busy = true;
        dialog.primary.disabled = true;
        dialog.primary.setAttribute('aria-busy', 'true');
        try {
            for (const [i, file] of plan.entries()) {
                if (!root.isConnected) return false;
                dialog.primary.textContent = `Writing ${i + 1} of ${plan.length}…`;
                updateStatus(`Splitting… ${i + 1}/${plan.length}`);
                const bytes = await rebuild(tab, [{ document: null, includePages: file.pages.map((p) => p - 1) }]);
                try {
                    await exportBytes(tab, joinPath(folder, file.name), bytes, false, options);
                } catch (error) {
                    console.error('Split failed:', error);
                    notice.querySelector('.notice-text').textContent = splitFailure(error, file, written);
                    notice.hidden = false;
                    updateStatus('Split stopped');
                    return false;
                }
                written.push(file.name);
            }
        } finally {
            tab.busy = false;
            dialog.primary.removeAttribute('aria-busy');
            if (root.isConnected) syncPrimary();
        }
        updateStatus(`Split into ${filesLabel(written.length)}`);
        showToast(`Split into ${filesLabel(written.length)} in “${middleCut(folder.split(/[\\/]/).filter(Boolean).pop() ?? folder)}”`, { tone: 'success' });
        return true;
    }

    for (const btn of root.querySelectorAll('[data-mode]')) btn.addEventListener('click', () => setMode(btn.dataset.mode));
    input.addEventListener('input', () => {
        notice.hidden = true;
        render();
    });
    q('#splitFolderBtn').addEventListener('click', async () => {
        try {
            const dir = await PDFService.ChooseExportFolder(tab.docId);
            if (!dir) return;
            folder = dir;
            notice.hidden = true;
            syncFolder();
            syncPrimary();
        } catch (error) {
            console.error('ChooseExportFolder failed:', error);
        }
    });
    setMode('ranges');
    syncFolder();
    return Boolean(await dialog.done);
}

/* ---------- Insert pages from file ---------- */

/**
 * pdf.js pageInfos that put files' pages ({ bytes, password, pages }) after
 * page at (0 = the front, n = the end) of an n-page document. first is the
 * first inserted page's new number.
 */
export function insertPlan(files, at, n) {
    const infos = [{ document: null }, ...files.map((file) => ({
        document: file.bytes,
        ...(file.password ? { password: file.password } : {}),
        // insertAfter is a 0-based page index (-1: the front); none appends.
        ...(at < n ? { insertAfter: at - 1 } : {})
    }))];
    const count = files.reduce((sum, file) => sum + file.pages, 0);
    return { infos, first: at + 1, count };
}

/** Loads a picked file in pdf.js for its bytes and page count, asking its password. Resolves null when cancelled. */
async function loadInsertFile(doc) {
    let password = null;
    let cancelled = false;
    const task = loadDocument(`/doc/${doc.id}`, async (update, reason) => {
        const entered = await showPrompt('This document is protected. Enter its password to insert its pages.', `“${doc.fileName}” needs a password`, {
            type: 'password', label: 'Password', icon: 'lock', confirmLabel: 'Insert',
            error: reason === PasswordResponses.INCORRECT_PASSWORD ? 'That password isn’t right. Try again.' : ''
        });
        if (entered === null) {
            cancelled = true;
            update(new Error('cancelled'));
            return;
        }
        password = entered;
        update(entered);
    });
    try {
        const pdf = await task.promise;
        return { fileName: doc.fileName, bytes: await pdf.getData(), pages: pdf.numPages, password };
    } catch (error) {
        if (cancelled) return null;
        throw error;
    } finally {
        task.destroy().catch(() => {});
    }
}

/** Asks where the files' pages go; resolves the page they go after (0..n), or null. */
async function chooseInsertPosition(tab, files, at) {
    const n = tab.totalPages;
    const afterPage = at > 0 && at < n ? at : tab.currentPage;
    let where = at === undefined || at >= n ? 'end' : at <= 0 ? 'start' : 'after';
    const total = files.reduce((sum, file) => sum + file.pages, 0);
    const options = [
        ['start', 'At the start'],
        ...(afterPage < n ? [['after', `After page ${afterPage}`]] : []),
        ['end', 'At the end']
    ];
    const body = fragment(`
        <div class="list-box insert-files" role="list" aria-label="Files to insert"></div>
        <div class="dialog-field">
            <span class="field-label" id="insertWhereLabel">Where</span>
            <div class="segmented full" role="group" aria-labelledby="insertWhereLabel">
                ${options.map(([value, label]) => `<button type="button" class="segment" data-where="${value}">${escapeHtml(label)}</button>`).join('')}
            </div>
        </div>`);
    const dialog = openDialog({
        id: 'insertDialog',
        title: 'Insert pages',
        size: 'sm',
        body,
        actions: [{ label: 'Cancel', value: null }, { label: `Insert ${pagesLabel(total)}`, value: 'insert', kind: 'primary' }],
        onAction: async () => ({ start: 0, after: afterPage, end: n })[where]
    });
    dialog.root.querySelector('.insert-files').append(...files.map((file) => fileRow(file.fileName, pagesLabel(file.pages))));
    const sync = () => {
        for (const btn of dialog.root.querySelectorAll('[data-where]')) btn.setAttribute('aria-pressed', String(btn.dataset.where === where));
    };
    for (const btn of dialog.root.querySelectorAll('[data-where]')) {
        btn.addEventListener('click', () => {
            where = btn.dataset.where;
            sync();
        });
    }
    sync();
    const result = await dialog.done;
    return result ?? null;
}

/**
 * Inserts the pages of PDFs picked in a file dialog, as an undoable page
 * change; at (pages before the insertion point, 0..n) presets where. A signed
 * document is warned about first.
 */
export async function insertFromFiles(tab, { at } = {}) {
    if (!tab?.pdfDocument || tab.busy) return false;
    if (!(await confirmSignedChange(tab))) return false;
    let docs = [];
    try {
        docs = (await PDFService.OpenPDFs()) ?? [];
        if (docs.length === 0) return false;
        const files = [];
        for (const doc of docs) {
            const file = await loadInsertFile(doc);
            if (!file) return false;
            files.push(file);
        }
        const after = await chooseInsertPosition(tab, files, at);
        if (after === null) return false;
        const { infos, first, count } = insertPlan(files, after, tab.totalPages);
        const inserted = Array.from({ length: count }, (_, i) => first + i);
        return await runPageOp(tab, 'Insert pages', async () => pushWorkingCopy(tab, await rebuild(tab, infos)),
            { page: first, selection: inserted, confirmed: true });
    } catch (error) {
        console.error('Insert from file failed:', error);
        await showMessage(sanitizeError(error), 'Lankir couldn’t read the file to insert', 'error');
        return false;
    } finally {
        for (const doc of docs) PDFService.ClosePDF(doc.id).catch(() => {});
    }
}

/* ---------- Protection ---------- */

const saveAction = (tab) => ({ label: 'Save', run: () => saveTab(tab.id) });

/** Asks for a password (twice) that the next save protects the document with. */
export async function protectDocument(tab) {
    if (!tab?.pdfDocument) return false;
    const changing = isProtected(tab);
    if (!(await confirmSignedChange(tab, { change: changing ? 'Changing its password' : 'Protecting it with a password' }))) return false;
    const body = fragment(`
        <p class="dialog-lead"></p>
        <div class="dialog-field">
            <label class="field-label" for="protectPassword">${changing ? 'New password' : 'Password'}</label>
            <div class="input-group">
                <input id="protectPassword" type="password" autocomplete="new-password" spellcheck="false">
                <button type="button" class="icon-btn sm" id="protectReveal" aria-pressed="false"></button>
            </div>
        </div>
        <div class="dialog-field">
            <label class="field-label" for="protectConfirm">Confirm password</label>
            <div class="input-group"><input id="protectConfirm" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="protectError"></div>
            <p class="field-error" id="protectError" role="alert"></p>
        </div>
        <div class="notice"><span class="notice-icon">${iconSvg('info', 'icon-sm')}</span><span>A lost password can’t be recovered. Without it, the file can’t be opened.</span></div>`);
    body[0].textContent = `Opening “${baseName(tab)}” will ask for ${changing ? 'the new' : 'this'} password. It is applied the next time you save.`;
    const dialog = openDialog({
        id: 'protectDialog',
        title: changing ? 'Change password' : 'Protect with password',
        size: 'sm',
        body,
        actions: [{ label: 'Cancel', value: null }, { label: changing ? 'Change password' : 'Set password', value: 'set', kind: 'primary' }],
        onAction: async () => {
            const [password, confirm] = fields.map((f) => f.value);
            if (!password) return fail(fields[0], 'Enter a password.');
            if (password !== confirm) return fail(fields[1], 'The passwords don’t match.');
            return password;
        }
    });
    const fields = ['#protectPassword', '#protectConfirm'].map((sel) => dialog.root.querySelector(sel));
    const error = dialog.root.querySelector('#protectError');
    const fail = (field, message) => {
        field.setAttribute('aria-invalid', 'true');
        error.textContent = message;
        field.focus();
        return false;
    };
    for (const field of fields) {
        field.addEventListener('input', () => {
            for (const f of fields) f.removeAttribute('aria-invalid');
            error.textContent = '';
        });
    }
    const reveal = dialog.root.querySelector('#protectReveal');
    const syncReveal = () => {
        const shown = fields[0].type === 'text';
        reveal.setAttribute('aria-pressed', String(shown));
        reveal.setAttribute('aria-label', shown ? 'Hide passwords' : 'Show passwords');
        reveal.dataset.tip = shown ? 'Hide passwords' : 'Show passwords';
        reveal.innerHTML = iconSvg(shown ? 'eye-off' : 'eye', 'icon-sm');
    };
    reveal.addEventListener('click', () => {
        const type = fields[0].type === 'password' ? 'text' : 'password';
        for (const f of fields) f.type = type;
        syncReveal();
        fields[0].focus();
    });
    syncReveal();

    const password = await dialog.done;
    if (!password) return false;
    tab.protect = password;
    refreshDirty(tab);
    updateStatus('The password is applied when you save (Ctrl+S)');
    showToast('The password is applied when you save', { action: saveAction(tab) });
    return true;
}

/** Makes the next save write the document without its password. */
export async function removeProtection(tab) {
    if (!tab?.pdfDocument || !isProtected(tab)) return false;
    if (tab.protect && !tab.password) {
        // Only set in this session: nothing on disk to remove.
        tab.protect = undefined;
        refreshDirty(tab);
        showToast('The password won’t be added');
        return true;
    }
    if (!(await confirmSignedChange(tab, { change: 'Removing its password' }))) return false;
    const name = baseName(tab);
    if (!(await showConfirm(`Anyone will be able to open “${name}”. The password is removed the next time you save.`,
        `Remove the password from “${name}”?`, { confirmLabel: 'Remove password', danger: true }))) return false;
    tab.protect = '';
    refreshDirty(tab);
    updateStatus('The password is removed when you save (Ctrl+S)');
    showToast('The password is removed when you save', { action: saveAction(tab) });
    return true;
}

/* ---------- Properties ---------- */

const FIELDS = [['Title', 'propTitle'], ['Author', 'propAuthor'], ['Subject', 'propSubject'], ['Keywords', 'propKeywords']];

function protectionFact(tab) {
    if (tab.protect === '' && tab.password) return 'No, once saved';
    if (tab.protect && !tab.password) return 'Yes, once saved';
    return isProtected(tab) ? 'Yes' : 'No';
}

function dateFact(value) {
    try {
        const date = typeof value === 'string' ? PDFDateString.toDateObject(value) : null;
        return date && !Number.isNaN(date.getTime()) ? formatDay(date) : '';
    } catch {
        return '';
    }
}

/** Shows the document's facts; title, author, subject and keywords change as an undoable edit. */
export async function editProperties(tab) {
    if (!tab?.pdfDocument) return false;
    let info = {};
    try {
        ({ info = {} } = await tab.pdfDocument.getMetadata());
    } catch (error) {
        console.error('Reading the properties failed:', error);
    }
    const text = (v) => (typeof v === 'string' ? v : '');
    const facts = [
        ['File', tab.fileName],
        ['Size', formatFileSize(tab.fileSize)],
        ['Pages', String(tab.totalPages)],
        ['PDF version', text(info.PDFFormatVersion)],
        ['Producer', text(info.Producer) || text(info.Creator)],
        ['Created', dateFact(info.CreationDate)],
        ['Modified', dateFact(info.ModDate)],
        ['Protected', protectionFact(tab)],
        ['Signed', tab.signed || tab.signatures?.length ? 'Yes' : 'No']
    ].filter(([, value]) => value);
    const body = fragment(`
        <div class="form-grid">
            ${FIELDS.map(([label, id]) => `<label class="field-label" for="${id}">${label}</label><input id="${id}" class="input" autocomplete="off">`).join('')}
            <h3 class="group-title dialog-section">Details</h3>
            <dl class="facts">
                ${facts.map(([label]) => `<div class="fact"><dt class="field-label">${label}</dt><dd></dd></div>`).join('')}
            </dl>
        </div>`);
    const original = Object.fromEntries(FIELDS.map(([name]) => [name, text(info[name])]));
    const dialog = openDialog({
        id: 'propertiesDialog',
        title: 'Properties',
        body,
        actions: [{ label: 'Cancel', value: null }, { label: 'Apply', value: 'apply', kind: 'primary' }],
        onAction: async () => read()
    });
    const inputs = FIELDS.map(([name, id]) => [name, dialog.root.querySelector(`#${id}`)]);
    const read = () => Object.fromEntries(inputs.map(([name, input]) => [name, input.value.trim()]));
    for (const [name, input] of inputs) {
        input.value = original[name];
        input.addEventListener('input', () => {
            const now = read();
            dialog.primary.disabled = FIELDS.every(([n]) => now[n] === original[n]);
        });
    }
    dialog.root.querySelectorAll('.fact dd').forEach((dd, i) => {
        dd.textContent = facts[i][1];
    });
    dialog.primary.disabled = true;

    const values = await dialog.done;
    if (!values) return false;
    const metadata = { ...values, Creator: text(info.Creator), Producer: text(info.Producer) };
    return runPageOp(tab, 'Edit properties', () => PDFService.SetMetadata(tab.docId, metadata),
        { page: tab.currentPage, selection: [...(tab.selection ?? [])] });
}

/* ---------- Revert, optimized copy, print ---------- */

/** Drops every unsaved change, after naming them, and reloads the file from disk. */
export async function revertToSaved(tab) {
    if (!tab?.pdfDocument || tab.busy || !refreshDirty(tab)) return false;
    const lost = [];
    if (tab.modified) lost.push('page and property changes');
    if (tab.protect !== undefined) lost.push('the password change');
    if (hasUnsavedEdits(tab)) lost.push('form and markup edits');
    const message = `The unsaved ${listFormat.format(lost.length ? lost : ['changes'])} will be lost. Lankir reloads the file as it was last saved.`;
    if (!(await showConfirm(message, `Revert “${tab.fileName}” to the saved file?`, { confirmLabel: 'Revert', danger: true }))) return false;
    tab.busy = true;
    try {
        const doc = await PDFService.RevertToSaved(tab.docId);
        tab.protect = undefined;
        tab.selection = new Set();
        await reloadTab(tab, { doc });
        updateStatus(`Reverted ${tab.fileName}`);
        showToast(`Reverted to the saved “${middleCut(tab.fileName)}”`);
        return true;
    } catch (error) {
        console.error('Revert failed:', error);
        await showMessage(sanitizeError(error), `Lankir couldn’t revert “${tab.fileName}”`, 'error');
        return false;
    } finally {
        tab.busy = false;
    }
}

/** Save as, with pdfcpu's size optimizations; the toast compares the sizes. */
export function saveOptimizedCopy(tab) {
    return saveTab(tab.id, { saveAs: true, optimize: true });
}

/* ---------- Menu and palette ---------- */

const loadedDoc = (tab) => Boolean(tab?.pdfDocument);
const ACTIONS = {
    revert: { label: 'Revert to saved…', icon: 'history', words: 'discard undo reload', run: revertToSaved, applies: isDirty },
    print: { label: 'Print…', icon: 'printer', shortcut: 'print', words: 'printer paper', run: printTab },
    insert: { label: 'Insert pages from file…', icon: 'file-plus', words: 'merge combine add append', run: (tab) => insertFromFiles(tab) },
    split: { label: 'Split into files…', icon: 'scissors', words: 'pages ranges separate', run: splitDocument, applies: (tab) => tab.totalPages > 1 },
    protect: { label: 'Protect with password…', icon: 'lock', words: 'encrypt security lock', run: protectDocument },
    unprotect: { label: 'Remove password…', icon: 'lock-open', words: 'decrypt unlock security', run: removeProtection, applies: isProtected },
    optimize: { label: 'Save optimized copy…', icon: 'shrink', words: 'compress smaller size reduce', run: saveOptimizedCopy },
    properties: { label: 'Properties…', icon: 'info', words: 'metadata title author subject keywords details', run: editProperties }
};
const labelFor = (name, tab) => (name === 'protect' && isProtected(tab) ? 'Change password…' : ACTIONS[name].label);
const applies = (name, tab) => loadedDoc(tab) && (ACTIONS[name].applies?.(tab) ?? true);

/** The Ctrl K commands for the tab's document tools that apply now. */
export function documentCommands(tab) {
    return Object.entries(ACTIONS).filter(([name]) => applies(name, tab)).map(([name, action]) => ({
        id: name,
        group: 'Document',
        icon: action.icon,
        label: labelFor(name, tab),
        shortcut: action.shortcut,
        words: action.words,
        run: () => action.run(tab)
    }));
}

/** Enables and names the menu's document items for the active tab; runs when the ≡ menu opens. */
export function syncDocumentMenu() {
    const tab = getActivePDF();
    for (const item of document.querySelectorAll('#mainMenu [data-doc-action]')) {
        const name = item.dataset.docAction;
        item.disabled = !applies(name, tab);
        if (name === 'protect') item.querySelector('.menu-label').textContent = tab ? labelFor(name, tab) : ACTIONS.protect.label;
    }
}

/** Binds the menu's document items. */
export function initDocumentTools() {
    for (const item of document.querySelectorAll('#mainMenu [data-doc-action]')) {
        item.addEventListener('click', () => {
            const tab = getActivePDF();
            if (applies(item.dataset.docAction, tab)) ACTIONS[item.dataset.docAction].run(tab);
        });
    }
}
