import { Browser, System, Window } from '@wailsio/runtime';
import { App, PDFService, RecentFilesService } from './backend.js';
import {
    state, getActivePDF, getNextTabId, createPDFData, addOpenPDF, removeOpenPDF, setActiveTab
} from './state.js';
import { loadDocument, createViewer, AnnotationEditorType, PasswordResponses } from './viewer.js';
import { showChoice, showConfirm, showMessage, showPrompt } from './messageDialog.js';
import { updateStatus, updatePageIndicator, updateZoomDisplay, sanitizeError, formatFileSize } from './utils.js';
import { showSidebars, hideSidebars } from './ui.js';
import { setupSidebar, showSidebarFor, disposeSidebar } from './sidebar.js';
import { attachFindBar, closeFindBar } from './findBar.js';
import { attachAnnotationToolbar, syncAnnotationToolbar } from './annotationToolbar.js';
import { loadSignatureInfo, clearSignatureInfo } from './signature.js';
import { loadRecentFilesWelcome } from './recentFiles.js';
import { getSetting } from './settings.js';
import { iconSvg } from './icons.js';
import { showToast } from './toast.js';
import { showOpenError, plainReason } from './errorRecovery.js';
import { showLoading } from './loadingIndicator.js';
import { setTabName, refreshTabStrip } from './tabStrip.js';
import { updatePageRoom } from './pageRoom.js';

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
        tab.pdfDocument = pdfDocument;
        tab.totalPages = pdfDocument.numPages;
        tab.savedHash = storageHash(tab);
        tab.touched = false;
        pdfDocument.annotationStorage.onSetModified = () => refreshDirty(tab);
        pdfDocument.annotationStorage.onResetModified = () => refreshDirty(tab);
        tab.view.pdfViewer.setDocument(pdfDocument);
        tab.view.linkService.setDocument(pdfDocument, null);
        setupSidebar(tab);
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
    updatePassword(password);
}

/** Connects a tab's pdf.js events to the shared UI. */
function wireViewer(tab) {
    const { eventBus, pdfViewer, container } = tab.view;
    const isActive = () => state.activeTabId === tab.id;

    eventBus.on('pagesinit', () => {
        const zoom = Number(getSetting('defaultZoom')) || 100;
        pdfViewer.currentScaleValue = String(zoom / 100);
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
 * Re-checks whether a tab's edits differ from what was last written. pdf.js'
 * own modified flag can't tell: saveDocument() clears it before the bytes reach
 * disk, and moving, recolouring or undoing an editor never sets it.
 */
export function refreshDirty(tab) {
    if (!tab.pdfDocument) return tab.dirty;
    const dirty = storageHash(tab) !== tab.savedHash;
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
        'If you don’t save, your changes will be lost.',
        `Save changes to “${tab.fileName}” before closing?`,
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
 * Writes the tab's current bytes (with form values and annotations) to its
 * file, or to a new one with saveAs. Resolves true when saved.
 */
export async function saveTab(tabId, { saveAs = false } = {}) {
    const tab = state.openPDFs.get(tabId);
    if (!tab?.pdfDocument) return false;
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
        let stopLoading = showLoading(`Saving ${tab.fileName}`);
        let doc;
        let bytes;
        try {
            // Not getData(): that returns the file as loaded, without edits saved since.
            bytes = await tab.pdfDocument.saveDocument();
            doc = await writeBytes(tab, bytes, target?.path);
        } catch (error) {
            stopLoading();
            if (error.cause?.conflict !== 'changed') throw error;
            const choice = await showChoice(
                `“${tab.fileName}” changed on disk since it was opened or last saved. Overwriting replaces those changes with yours.`,
                `Overwrite “${tab.fileName}”?`,
                [{ label: 'Save as…', value: 'saveAs', start: true }, { label: 'Cancel', value: 'cancel' }, { label: 'Overwrite', value: 'overwrite', danger: true }]
            );
            if (choice === 'saveAs') return await saveTab(tabId, { saveAs: true });
            if (choice !== 'overwrite') {
                updateStatus('Save cancelled');
                return false;
            }
            stopLoading = showLoading(`Saving ${tab.fileName}`);
            doc = await writeBytes(tab, bytes, null, true);
        } finally {
            stopLoading();
        }
        const elapsed = Math.round(performance.now() - started);

        tab.savedHash = hash;
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
        if (state.activeTabId === tab.id) refreshActiveTab();
        updateStatus(`Saved ${tab.fileName} (${(bytes.length / 1048576).toFixed(1)} MB in ${elapsed} ms)`);
        showToast(`Saved ${tab.fileName}`, { tone: 'success' });
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
 * returned). On Linux the raw bytes go to the document route; the binding
 * call is limited by its base64 JSON body. A conflict rejects with an error
 * whose cause is Go's ConflictError ({ conflict, path }).
 */
async function writeBytes(tab, bytes, saveAsPath, overwrite = false) {
    if (System.IsLinux()) {
        const url = new URL(DOC_ROUTE + tab.docId, location.href);
        if (saveAsPath) url.searchParams.set('saveAs', saveAsPath);
        if (overwrite) url.searchParams.set('overwrite', '1');
        const res = await fetch(url, { method: 'PUT', body: bytes });
        if (res.ok) return res.json();
        const text = (await res.text()).trim();
        if (res.status === 409) throw new Error('Save conflict', { cause: JSON.parse(text) });
        throw new Error(text || `HTTP ${res.status}`);
    }
    if (bytes.length > BINDING_SAVE_LIMIT) {
        throw new Error(`The document is too large to save from the editor (${(bytes.length / 1048576).toFixed(0)} MB; the limit is about 48 MB).`);
    }
    const data = bytes.toBase64();
    return saveAsPath
        ? PDFService.SavePDFAs(tab.docId, saveAsPath, data)
        : PDFService.SavePDF(tab.docId, data, overwrite);
}

/** Go asks this when the window is closed with unsaved tabs. */
export async function handleCloseRequested() {
    for (const tab of [...state.openPDFs.values()]) {
        if (refreshDirty(tab) && (await resolveUnsaved(tab)) === 'cancel') return;
    }
    await App.ConfirmClose();
}
