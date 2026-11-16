import { Browser, System, Window } from '@wailsio/runtime';
import { App, PDFService, RecentFilesService } from './backend.js';
import {
    state, getActivePDF, getNextTabId, createPDFData, addOpenPDF, removeOpenPDF, setActiveTab
} from './state.js';
import { loadDocument, createViewer, AnnotationEditorType, PasswordResponses } from './viewer.js';
import { showChoice, showConfirm, showMessage, showPrompt } from './messageDialog.js';
import { updateStatus, updatePageIndicator, updateZoomDisplay, sanitizeError, formatFileSize, middleCut } from './utils.js';
import { showSidebars, hideSidebars } from './ui.js';
import { setupSidebar, showSidebarFor, disposeSidebar } from './sidebar.js';
import { attachFindBar, closeFindBar } from './findBar.js';
import { attachAnnotationToolbar, syncAnnotationToolbar } from './annotationToolbar.js';
import { loadSignatureInfo, clearSignatureInfo } from './signature.js';
import { loadRecentFilesWelcome } from './recentFiles.js';
import { getSetting } from './settings.js';
import { iconSvg } from './icons.js';
import { showToast, showBusy } from './toast.js';
import { showOpenError, plainReason } from './errorRecovery.js';
import { showLoading } from './loadingIndicator.js';
import { setTabName, refreshTabStrip, tabLabel } from './tabStrip.js';
import { updatePageRoom } from './pageRoom.js';
import { syncOrganize, disposeOrganize } from './organize.js';

const DOC_ROUTE = '/doc/';
const AUTO_SCALES = ['auto', 'page-width', 'page-fit', 'page-actual'];
const RECHECK_DELAY = 200;
// A binding call sends base64 in a JSON body that Wails caps at 64 MiB.
const BINDING_SAVE_LIMIT = 48 * 1024 * 1024;

const viewerHost = () => document.getElementById('pdfViewer');

function findTabByPath(path) {
    for (const tab of state.openPDFs.values()) {
        if (tab.filePath === path) return tab;
    }
    return null;
}

/** Shows the native open dialog and opens the chosen PDF in a tab. */
export async function openPDFFile() {
    let doc = null;
    try {
        doc = await PDFService.OpenPDF();
        if (!doc) return null;
        const existing = findTabByPath(doc.path);
        if (existing) {
            await PDFService.ClosePDF(doc.id);
            await switchToTab(existing.id);
            return existing.id;
        }
        return await openRegisteredDocument(doc);
    } catch (error) {
        reportOpenError(error, doc?.path);
        return null;
    }
}

/** Opens path in a tab, or switches to the tab that already shows it. Throws on failure. */
export async function openFilePath(path) {
    const existing = findTabByPath(path);
    if (existing) {
        await switchToTab(existing.id);
        return existing.id;
    }
    return openRegisteredDocument(await PDFService.OpenPDFByPath(path));
}

/** openFilePath for UI callers: reports errors instead of throwing. */
export async function openRecentFile(path) {
    try {
        return await openFilePath(path);
    } catch (error) {
        reportOpenError(error, path);
        return null;
    }
}

function reportOpenError(error, path) {
    console.error('Error opening PDF:', error);
    updateStatus('Error opening PDF: ' + sanitizeError(error));
    showOpenError(error, { path, onChooseAnother: openPDFFile });
}

async function openRegisteredDocument(doc) {
    const previousTabId = state.activeTabId;
    const tab = createPDFData(getNextTabId(), doc.path, doc.id);
    tab.fileSize = doc.size;
    // One side panel holds what the left (pages) and right (signatures) sidebars did.
    const showPages = getSetting('showLeftSidebar') === true;
    const showSignatures = getSetting('showRightSidebar') === true;
    tab.panelOpen = showPages || showSignatures;
    tab.panelTab = showSignatures && !showPages ? 'signatures' : 'pages';
    addOpenPDF(tab.id, tab);
    createTabElement(tab);
    updateStatus(`Opening ${tab.fileName}...`);

    // pdf.js never settles a loading task destroyed mid-load, so closing the
    // tab has to end the wait itself.
    const closed = new Promise((resolve) => { tab.onClosed = resolve; });
    tab.stopLoading = showLoading(`Opening ${tab.fileName}`);
    try {
        const view = await createViewer(viewerHost());
        if (tab.closed) {
            view.container.remove();
            return null;
        }
        tab.view = view;
        await switchToTab(tab.id);
        wireViewer(tab);
        tab.loadingTask = loadDocument(DOC_ROUTE + tab.docId, (update, reason) => askPassword(tab, update, reason));
        const pdfDocument = await Promise.race([tab.loadingTask.promise, closed]);
        if (tab.closed) return null;
        await adoptDocument(tab, pdfDocument);
        if (tab.closed) return null;
    } catch (error) {
        if (tab.closed) return null;
        const wasActive = state.activeTabId === tab.id;
        disposeTab(tab);
        if (wasActive) {
            if (previousTabId === null) switchToHome();
            else await showRemainingTab(previousTabId);
        }
        if (tab.passwordCancelled) {
            updateStatus('Opening cancelled');
            return null;
        }
        throw error;
    } finally {
        tab.stopLoading();
    }

    if (state.activeTabId === tab.id) refreshActiveTab();
    updateStatus(`Opened ${tab.fileName}`);
    RecentFilesService.AddRecent(tab.filePath, tab.totalPages).catch((err) => console.error('AddRecent failed:', err));
    return tab.id;
}

async function askPassword(tab, updatePassword, reason) {
    const wrong = reason === PasswordResponses.INCORRECT_PASSWORD;
    tab.stopLoading?.();
    const password = await showPrompt(
        'This document is protected. Enter its password to open it.',
        `“${tab.fileName}” needs a password`,
        { type: 'password', label: 'Password', error: wrong ? 'That password isn’t right. Try again.' : '', confirmLabel: 'Open', icon: 'lock' }
    );
    if (password !== null && !tab.closed) tab.stopLoading = showLoading(`Opening ${tab.fileName}`);
    if (password === null) {
        tab.passwordCancelled = true;
        // Rejects the loading task with a PasswordException; destroy() would
        // leave it pending forever.
        updatePassword(new Error('cancelled'));
        return;
    }
    // Reloads and Go's pdfcpu operations need it again.
    tab.password = password;
    PDFService.SetPassword(tab.docId, password).catch((err) => console.error('SetPassword failed:', err));
    updatePassword(password);
}

/** Shows a loaded pdf.js document in its tab, replacing what the tab showed. */
async function adoptDocument(tab, pdfDocument) {
    const { info } = await pdfDocument.getMetadata();
    if (tab.closed) return;
    tab.pdfDocument = pdfDocument;
    tab.totalPages = pdfDocument.numPages;
    tab.encrypted = Boolean(info?.EncryptFilterName);
    tab.signed = Boolean(info?.IsSignaturesPresent);
    tab.savedHash = storageHash(tab);
    tab.touched = false;
    tab.editingState = {};
    pdfDocument.annotationStorage.onSetModified = () => refreshDirty(tab);
    pdfDocument.annotationStorage.onResetModified = () => refreshDirty(tab);
    disposeSidebar(tab);
    tab.view.pdfViewer.setDocument(pdfDocument);
    tab.view.linkService.setDocument(pdfDocument, null);
    setupSidebar(tab);
}

/**
 * Reloads a tab from what Go serves for it now (after a page operation, undo
 * or revert), keeping the zoom and showing page (default: the current one).
 * doc, when given, is Go's document state to take over.
 */
export async function reloadTab(tab, { page, doc } = {}) {
    if (doc) {
        tab.modified = doc.modified;
        tab.undoSteps = doc.undoSteps;
        tab.redoSteps = doc.redoSteps ?? 0;
    }
    const viewer = tab.view.pdfViewer;
    const scale = viewer.currentScaleValue;
    const task = loadDocument(`${DOC_ROUTE}${tab.docId}?v=${++tab.loadSeq}`, (update, reason) => askPassword(tab, update, reason), tab.password);
    let pdfDocument;
    try {
        pdfDocument = await task.promise;
    } catch (error) {
        task.destroy().catch(() => {});
        throw error;
    }
    if (tab.closed) {
        task.destroy().catch(() => {});
        return;
    }
    const previous = tab.loadingTask;
    tab.loadingTask = task;
    tab.currentPage = Math.min(Math.max(page ?? tab.currentPage, 1), pdfDocument.numPages);
    tab.restoreView = { scale, page: tab.currentPage };
    await adoptDocument(tab, pdfDocument);
    previous?.destroy().catch(() => {});
    refreshDirty(tab);
    if (state.activeTabId === tab.id) refreshActiveTab();
}

/** Connects a tab's pdf.js events to the shared UI. */
function wireViewer(tab) {
    const { eventBus, pdfViewer, container } = tab.view;
    const isActive = () => state.activeTabId === tab.id;

    eventBus.on('pagesinit', () => {
        const restore = tab.restoreView;
        if (restore) {
            pdfViewer.currentScaleValue = restore.scale;
            pdfViewer.currentPageNumber = restore.page;
            return;
        }
        const zoom = Number(getSetting('defaultZoom')) || 100;
        pdfViewer.currentScaleValue = String(zoom / 100);
    });
    // Until every page's size is known, pages are laid out with the first
    // one's, so the page scrolled to at pagesinit can drift off screen.
    eventBus.on('pagesloaded', () => {
        if (tab.restoreView) pdfViewer.currentPageNumber = tab.restoreView.page;
        tab.restoreView = null;
    });
    eventBus.on('pagechanging', ({ pageNumber }) => {
        tab.currentPage = pageNumber;
        if (isActive()) updatePageIndicator(pageNumber, tab.totalPages);
    });
    eventBus.on('scalechanging', ({ scale }) => {
        if (isActive()) updateZoomDisplay(scale);
    });
    // Pages change width with the zoom; they are laid out after this event.
    eventBus.on('scalechanging', () => requestAnimationFrame(() => isActive() && updatePageRoom()));
    attachFindBar(tab);
    attachAnnotationToolbar(tab);

    // Edits that pdf.js reports through no storage callback: moving or
    // recolouring an editor, undo after a save, a choice field. A drag can
    // end anywhere in the window.
    tab.recheck = () => {
        clearTimeout(tab.recheckTimer);
        tab.recheckTimer = setTimeout(() => refreshDirty(tab), RECHECK_DELAY);
    };
    const touch = () => { tab.touched = true; };
    for (const name of ['editingstateschanged', 'editingaction', 'switchannotationeditorparams']) eventBus.on(name, tab.recheck);
    for (const name of ['editingaction', 'switchannotationeditorparams']) eventBus.on(name, touch);
    for (const type of ['keyup', 'input', 'change']) container.addEventListener(type, tab.recheck, true);
    for (const type of ['pointerdown', 'keydown', 'input']) container.addEventListener(type, touch, true);
    window.addEventListener('pointerup', tab.recheck, true);

    // Rendering a page writes to the storage too: a selected radio button
    // sets its siblings off. Until the user acts, that is the clean state.
    eventBus.on('annotationlayerrendered', () => {
        if (tab.touched || !tab.pdfDocument) return;
        tab.savedHash = storageHash(tab);
        refreshDirty(tab);
    });

    // Any other link would navigate the app's webview away: web and mail
    // links open in the system browser, the rest do nothing. In-document links
    // ("#..." or "" with a click handler) stay with pdf.js.
    container.addEventListener('click', (e) => {
        const link = e.target.closest?.('a[href]');
        const href = link?.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        e.preventDefault();
        e.stopPropagation();
        if (/^(https?|mailto):/i.test(href)) {
            Browser.OpenURL(href).catch((err) => console.error('OpenURL failed:', err));
        }
    }, true);

    // Fit-to-width/page are relative to the container, which changes with
    // the window and the sidebars.
    tab.resizeObserver = new ResizeObserver(() => {
        if (pdfViewer.pdfDocument && container.clientWidth > 0 && AUTO_SCALES.includes(pdfViewer.currentScaleValue)) {
            pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
        }
        if (isActive()) updatePageRoom();
    });
    tab.resizeObserver.observe(container);
}

function createTabElement(tab) {
    const el = document.createElement('div');
    el.className = 'pdf-tab';
    el.dataset.tabId = tab.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('aria-controls', 'pdfViewer');
    el.tabIndex = 0;
    el.innerHTML = `
        <span class="pdf-tab-name"></span>
        <button class="pdf-tab-close" tabindex="-1" data-tip="Close" data-keys="Ctrl W">
            <span class="pdf-tab-dirty" aria-hidden="true"></span>${iconSvg('x', 'icon-sm')}
        </button>
    `;
    setTabLabel(el, tab);
    el.addEventListener('click', (e) => {
        if (!e.target.closest('.pdf-tab-close')) switchToTab(tab.id);
    });
    // Middle click closes, as in other tabbed apps.
    el.addEventListener('auxclick', (e) => {
        if (e.button === 1) closeTab(tab.id);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            switchToTab(tab.id);
        }
    });
    el.querySelector('.pdf-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
    });
    const container = document.getElementById('pdfTabsContainer');
    container.appendChild(el);
    container.classList.add('has-tabs');
    refreshTabStrip();
}

const tabTip = (tab) => (tab.dirty ? `${tab.filePath} (unsaved changes)` : tab.filePath);

function setTabLabel(el, tab) {
    setTabName(el.querySelector('.pdf-tab-name'), tab.fileName);
    el.setAttribute('aria-label', tab.fileName);
    el.dataset.tip = tabTip(tab);
    refreshTabStrip();
    el.querySelector('.pdf-tab-close').setAttribute('aria-label', `Close ${tab.fileName}`);
}

const tabElement = (tabId) => document.querySelector(`.pdf-tab[data-tab-id="${tabId}"]`);

function updateWindowTitle() {
    const tab = getActivePDF();
    const title = tab ? `${tab.dirty ? '• ' : ''}${tab.fileName} - Lankir` : 'Lankir';
    Window.SetTitle(title).catch(() => {});
}

// What the edits in pdf.js' annotation storage serialize to. Bitmaps are only
// copied for the hash, so they are released at once.
function storageHash(tab) {
    const { hash, transfer } = tab.pdfDocument.annotationStorage.serializable;
    for (const bitmap of transfer ?? []) bitmap.close?.();
    return hash;
}

/**
 * Re-checks whether a tab differs from what was last written: an unsaved page
 * operation, a pending protection change, or annotation and form edits.
 * pdf.js' own modified flag can't tell the latter: saveDocument() clears it
 * before the bytes reach disk, and moving, recolouring or undoing an editor
 * never sets it.
 */
export function refreshDirty(tab) {
    if (!tab.pdfDocument) return tab.dirty;
    const dirty = Boolean(tab.modified) || tab.protect !== undefined || hasUnsavedEdits(tab);
    const holdsEdits = tab.pdfDocument.annotationStorage.size > 0;
    if (tab.dirty === dirty && tab.holdsEdits === holdsEdits) return dirty;
    if (tab.dirty !== dirty) {
        tab.dirty = dirty;
        const el = tabElement(tab.id);
        el?.classList.toggle('dirty', dirty);
        if (el) el.dataset.tip = tabTip(tab);
        if (state.activeTabId === tab.id) updateWindowTitle();
    }
    tab.holdsEdits = holdsEdits;
    reportUnsaved();
    return dirty;
}

/** True when the tab's annotation and form edits aren't in what Go serves for it. */
export function hasUnsavedEdits(tab) {
    return storageHash(tab) !== tab.savedHash;
}

// Starts from the clock so Go doesn't ignore a reloaded page's reports.
let unsavedSeq = Date.now();

// Go asks before closing the window only when told something may be unsaved.
// Some edits change the storage without any event seen here, so every tab
// holding edits counts and handleCloseRequested decides.
function reportUnsaved() {
    const unsaved = [...state.openPDFs.values()].some((tab) => tab.dirty || tab.holdsEdits);
    App.SetUnsavedChanges(++unsavedSeq, unsaved).catch((err) => console.error('SetUnsavedChanges failed:', err));
}

/** Shows a tab's viewer and points the shared UI at it. */
export async function switchToTab(tabId) {
    const tab = state.openPDFs.get(tabId);
    if (!tab) return;
    const previous = getActivePDF();
    if (previous && previous !== tab) leaveTab(previous);

    for (const el of document.querySelectorAll('.pdf-tab')) {
        const active = el.dataset.tabId === String(tabId);
        el.classList.toggle('active', active);
        el.setAttribute('aria-selected', String(active));
        el.tabIndex = active ? 0 : -1;
    }
    for (const other of state.openPDFs.values()) {
        other.view?.container.classList.toggle('hidden', other !== tab);
    }
    document.getElementById('welcomeScreen')?.classList.add('hidden');
    document.getElementById('app')?.classList.remove('no-doc');

    setActiveTab(tabId);
    showSidebars();
    refreshActiveTab();
    // A viewer gets no scroll event when it is unhidden; without this its
    // pages can stay blank until the user scrolls or zooms.
    if (tab.view?.pdfViewer.pdfDocument) tab.view.pdfViewer.update();
    tab.view?.container.focus({ preventScroll: true });
    refreshTabStrip();
}

/** Shows the tab after the active one, wrapping round to the first. */
export async function switchToNextTab() {
    const ids = [...state.openPDFs.keys()];
    if (ids.length === 0) return;
    await switchToTab(ids[(ids.indexOf(state.activeTabId) + 1) % ids.length]);
}

function leaveTab(tab) {
    closeFindBar(tab);
    tab.cancelPlacement?.();
    // A hidden viewer left in an editing mode would keep reacting to Ctrl+Z,
    // Delete and arrow keys on the window.
    const viewer = tab.view?.pdfViewer;
    if (viewer?.pdfDocument && viewer.annotationEditorMode > AnnotationEditorType.NONE) {
        viewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
    }
}

/** Re-reads the active tab into the toolbar, footer, sidebars and title. */
export function refreshActiveTab() {
    const tab = getActivePDF();
    if (!tab) return;
    const viewer = tab.view?.pdfViewer;
    const loaded = Boolean(viewer?.pdfDocument);
    updatePageIndicator(loaded ? tab.currentPage : null, tab.totalPages);
    if (loaded) updateZoomDisplay(viewer.currentScale);
    document.getElementById('fileName').textContent = tab.fileName;
    document.getElementById('pageCount').textContent = tab.totalPages || '-';
    const size = document.getElementById('fileSize');
    if (size) {
        size.textContent = formatFileSize(tab.fileSize);
        size.closest('.fact')?.toggleAttribute('hidden', !size.textContent);
    }
    const signBtn = document.getElementById('signBtn');
    if (signBtn) signBtn.disabled = !loaded;
    showSidebarFor(tab);
    syncAnnotationToolbar(tab);
    syncOrganize(tab);
    updatePageRoom();
    updateWindowTitle();
    if (loaded) loadSignatureInfo(tab.filePath);
    else clearSignatureInfo();
}

/** Shows the welcome screen; tabs stay open in the background. */
export function switchToHome() {
    const previous = getActivePDF();
    if (previous) leaveTab(previous);
    for (const el of document.querySelectorAll('.pdf-tab')) {
        el.classList.remove('active');
        el.setAttribute('aria-selected', 'false');
    }
    for (const tab of state.openPDFs.values()) tab.view?.container.classList.add('hidden');
    document.getElementById('welcomeScreen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('no-doc');
    setActiveTab(null);
    hideSidebars();
    syncOrganize(null);
    updatePageIndicator(null, null);
    const signBtn = document.getElementById('signBtn');
    if (signBtn) signBtn.disabled = true;
    updateWindowTitle();
    updateStatus('Ready');
    loadRecentFilesWelcome();
}

/**
 * Asks what to do with a dirty tab's edits. Resolves 'save' (saved),
 * 'discard' or 'cancel'; a failed save counts as cancel.
 */
export async function resolveUnsaved(tab) {
    if (state.activeTabId !== tab.id) await switchToTab(tab.id);
    const choice = await showChoice(
        `“${tabLabel(tab.fileName)}” has changes that aren’t saved. If you don’t save, they will be lost.`,
        'Save changes before closing?',
        [
            { label: 'Don’t save', value: 'discard', danger: true, start: true },
            { label: 'Cancel', value: 'cancel' },
            { label: 'Save', value: 'save', primary: true }
        ]
    );
    if (choice === 'save') return (await saveTab(tab.id)) ? 'save' : 'cancel';
    return choice === 'discard' ? 'discard' : 'cancel';
}

/** Closes a tab, asking about unsaved edits first. Resolves false if the user cancels. */
export async function closeTab(tabId) {
    const tab = state.openPDFs.get(tabId);
    if (!tab) return true;
    if (refreshDirty(tab) && (await resolveUnsaved(tab)) === 'cancel') return false;

    const wasActive = state.activeTabId === tabId;
    disposeTab(tab);
    if (wasActive) await showRemainingTab();
    return true;
}

/** Shows preferredId if it is still open, else the first tab, else the welcome screen. */
async function showRemainingTab(preferredId) {
    const next = state.openPDFs.has(preferredId) ? preferredId : state.openPDFs.keys().next().value;
    if (next === undefined) switchToHome();
    else await switchToTab(next);
}

function disposeTab(tab) {
    if (tab.closed) return;
    tab.closed = true;
    tab.onClosed?.();
    tab.cancelPlacement?.();
    if (state.activeTabId === tab.id) {
        closeFindBar(tab);
        setActiveTab(null);
    }
    disposeSidebar(tab);
    disposeOrganize(tab);
    tab.resizeObserver?.disconnect();
    clearTimeout(tab.recheckTimer);
    window.removeEventListener('pointerup', tab.recheck, true);
    if (tab.view) {
        tab.view.pdfViewer.setDocument(null);
        tab.view.linkService.setDocument(null);
        tab.view.container.remove();
    }
    // PDFDocumentProxy.destroy() is gone in pdf.js 6; the loading task owns the worker side.
    tab.loadingTask?.destroy().catch(() => {});
    PDFService.ClosePDF(tab.docId).catch((err) => console.error('ClosePDF failed:', err));
    tabElement(tab.id)?.remove();
    removeOpenPDF(tab.id);
    if (state.openPDFs.size === 0) document.getElementById('pdfTabsContainer')?.classList.remove('has-tabs');
    refreshTabStrip();
    tab.dirty = false;
    tab.holdsEdits = false;
    reportUnsaved();
}

/**
 * How a save of tab is written: null to write pdf.js' bytes as they are, or
 * the SaveOptions that have Go rewrite them, to change or remove the
 * protection, optimize, or protect again a copy that a page operation
 * decrypted.
 */
export function saveOptionsFor(tab, optimize = false) {
    // pdf.js saves an encrypted document with its own encryption.
    if (tab.encrypted && tab.protect === undefined && !optimize) return null;
    const password = tab.protect ?? tab.password ?? '';
    if (!password && !optimize && !tab.encrypted) return null;
    return { rewrite: true, password, optimize };
}

/**
 * Writes the tab's current bytes (with form values and annotations) to its
 * file, or to a new one with saveAs; optimize has Go shrink them. Resolves
 * true when saved.
 */
export async function saveTab(tabId, { saveAs = false, optimize = false } = {}) {
    const tab = state.openPDFs.get(tabId);
    if (!tab?.pdfDocument) return false;
    if (tab.busy) {
        showBusy();
        return false;
    }
    // A page operation meanwhile would change Go's copies or reload the
    // document under the save.
    tab.busy = true;
    try {
        return await writeTab(tab, saveAs, optimize);
    } finally {
        tab.busy = false;
        // The save's refresh of the view ran while the tab was held.
        if (state.activeTabId === tab.id) syncOrganize(tab);
    }
}

async function writeTab(tab, saveAs, optimize) {
    try {
        let target = null;
        if (saveAs) {
            target = await PDFService.ChooseSavePath(tab.docId);
            if (!target) return false;
            const other = findTabByPath(target.path);
            if (other && other !== tab) {
                const choice = await showChoice(
                    `“${other.fileName}” is open in another tab. Lankir closes that tab and replaces the file.`,
                    `Replace “${other.fileName}”?`,
                    [{ label: 'Cancel', value: 'cancel' }, { label: 'Close and replace', value: 'close', danger: true }]
                );
                if (choice !== 'close' || !(await closeTab(other.id))) return false;
            } else if (target.exists && target.path !== tab.filePath &&
                !(await showConfirm('A file with that name already exists in the folder. Replacing it overwrites its contents.',
                    `Replace “${target.path.split(/[/\\]/).pop()}”?`, { confirmLabel: 'Replace', danger: true }))) {
                return false;
            }
        }

        updateStatus(`Saving ${tab.fileName}...`);
        const started = performance.now();
        const hash = storageHash(tab);
        const { protect } = tab;
        const options = saveOptionsFor(tab, optimize);
        let stopLoading = showLoading(`Saving ${tab.fileName}`);
        let doc;
        let bytes;
        try {
            // Not getData(): that returns the file as loaded, without edits saved since.
            bytes = await tab.pdfDocument.saveDocument();
            doc = await writeBytes(tab, bytes, target?.path, false, options);
        } catch (error) {
            stopLoading();
            if (error.cause?.conflict !== 'changed') throw error;
            const choice = await showChoice(
                `“${tab.fileName}” changed on disk since it was opened or last saved. Overwriting replaces those changes with yours.`,
                `Overwrite “${tab.fileName}”?`,
                [{ label: 'Save as…', value: 'saveAs', start: true }, { label: 'Cancel', value: 'cancel' }, { label: 'Overwrite', value: 'overwrite', danger: true }]
            );
            if (choice === 'saveAs') return await writeTab(tab, true, optimize);
            if (choice !== 'overwrite') {
                updateStatus('Save cancelled');
                return false;
            }
            stopLoading = showLoading(`Saving ${tab.fileName}`);
            doc = await writeBytes(tab, bytes, null, true, options);
        } finally {
            stopLoading();
        }
        const elapsed = Math.round(performance.now() - started);
        const sizeBefore = tab.fileSize;

        tab.savedHash = hash;
        tab.modified = false;
        tab.undoSteps = 0;
        tab.redoSteps = 0;
        // Without a pending change, the file keeps the password it had.
        if (protect !== undefined) tab.password = protect || null;
        // One set while writing is for the next save.
        if (tab.protect === protect) tab.protect = undefined;
        // Edits made while saving keep the tab dirty and count as touched.
        if (!refreshDirty(tab)) tab.touched = false;
        if (doc?.size) tab.fileSize = doc.size;
        if (doc && doc.path !== tab.filePath) {
            tab.filePath = doc.path;
            tab.fileName = doc.fileName;
            const el = tabElement(tab.id);
            if (el) setTabLabel(el, tab);
            RecentFilesService.AddRecent(tab.filePath, tab.totalPages).catch(() => {});
        }
        // The file's encryption no longer matches what pdf.js loaded, whose
        // next incremental save would bring the old one back.
        if (options && tab.encrypted) await reloadTab(tab);
        else if (state.activeTabId === tab.id) refreshActiveTab();
        updateStatus(`Saved ${tab.fileName} (${(bytes.length / 1048576).toFixed(1)} MB in ${elapsed} ms)`);
        const shrunk = optimize && sizeBefore && doc?.size ? ` · ${formatFileSize(sizeBefore)} → ${formatFileSize(doc.size)}` : '';
        showToast(`Saved ${middleCut(tab.fileName)}${shrunk}`, { tone: 'success' });
        console.log(`save ${tab.fileName}: ${bytes.length} bytes in ${elapsed} ms`);
        return true;
    } catch (error) {
        console.error('Error saving PDF:', error);
        updateStatus('Save failed');
        await showMessage(plainReason(error) ?? sanitizeError(error), `Lankir couldn’t save “${tab.fileName}”`, 'error');
        return false;
    }
}

/**
 * Writes bytes to the tab's file, or to saveAsPath (the path ChooseSavePath
 * returned). A conflict rejects with an error whose cause is Go's
 * ConflictError ({ conflict, path }). options are Go's SaveOptions for this
 * write.
 */
async function writeBytes(tab, bytes, saveAsPath, overwrite = false, options = null) {
    const query = {};
    if (saveAsPath) query.saveAs = saveAsPath;
    if (overwrite) query.overwrite = '1';
    return withSaveOptions(tab, options, () => sendBytes(tab, bytes, query, (data) => (saveAsPath
        ? PDFService.SavePDFAs(tab.docId, saveAsPath, data)
        : PDFService.SavePDF(tab.docId, data, overwrite))));
}

/** Sets options (Go's SaveOptions) for the write that write() makes. */
async function withSaveOptions(tab, options, write) {
    if (!options) return write();
    await PDFService.SetSaveOptions(tab.docId, options);
    try {
        return await write();
    } catch (error) {
        // A write refused before Go read it would leave them for the next one.
        await PDFService.SetSaveOptions(tab.docId, { rewrite: false, password: '', optimize: false }).catch(() => {});
        throw error;
    }
}

/** Makes bytes the tab's new working copy (an undoable, unsaved page operation); resolves Go's document. */
export function pushWorkingCopy(tab, bytes) {
    return sendBytes(tab, bytes, { work: '1' }, (data) => PDFService.PushWorkingCopy(tab.docId, data));
}

/**
 * The SaveOptions for a new file written from tab (extracted or split
 * pages): its password, as the next save would apply it, unless protect is
 * false. null writes the bytes as they are.
 */
export function exportOptionsFor(tab, { protect = true } = {}) {
    const password = protect ? tab.protect ?? tab.password ?? '' : '';
    if (password) return { rewrite: true, password, optimize: false };
    // pdf.js copies the /Encrypt of a document that all the pages come from,
    // so Go has to decrypt them.
    return tab.encrypted && tab.password ? { rewrite: true, password: '', optimize: false } : null;
}

/**
 * Writes bytes to path, a new file chosen in a dialog, without touching the
 * tab. options are Go's SaveOptions for the write; by default a file from a
 * protected document keeps its password.
 */
export async function exportBytes(tab, path, bytes, overwrite = false, options = exportOptionsFor(tab)) {
    const query = overwrite ? { export: path, overwrite: '1' } : { export: path };
    return withSaveOptions(tab, options, () => sendBytes(tab, bytes, query, (data) => PDFService.ExportPDF(tab.docId, path, data, overwrite)));
}

/**
 * Hands bytes to Go for the tab. On Linux they go raw to the document route
 * with query; elsewhere through binding(base64), which is limited by its
 * base64 JSON body.
 */
async function sendBytes(tab, bytes, query, binding) {
    if (System.IsLinux()) {
        const url = new URL(DOC_ROUTE + tab.docId, location.href);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        const res = await fetch(url, { method: 'PUT', body: bytes });
        if (res.ok) return res.json();
        const text = (await res.text()).trim();
        if (res.status === 409) throw new Error('Save conflict', { cause: JSON.parse(text) });
        throw new Error(text || `HTTP ${res.status}`);
    }
    if (bytes.length > BINDING_SAVE_LIMIT) {
        throw new Error(`The document is too large to save from the editor (${(bytes.length / 1048576).toFixed(0)} MB; the limit is about 48 MB).`);
    }
    return binding(bytes.toBase64());
}

/** Go asks this when the window is closed with unsaved tabs. */
export async function handleCloseRequested() {
    for (const tab of [...state.openPDFs.values()]) {
        if (refreshDirty(tab) && (await resolveUnsaved(tab)) === 'cancel') return;
    }
    await App.ConfirmClose();
}
