import { getSetting, setSetting } from './settings.js';
import { showMessage } from './messageDialog.js';
import { showToast } from './toast.js';
import { escapeHtml } from './utils.js';
import { iconSvg } from './icons.js';
import { renderCertificateList, escapeAttr } from './certificateRenderer.js';
import { App, SignatureService } from './backend.js';

// Each configured path list: its setting, container, remove-button class and wording.
const PATH_LISTS = {
    stores: { setting: 'certificateStores', container: 'storesList', removeClass: 'cert-store-remove', icon: 'folder', noun: 'folder', empty: 'No certificate folders' },
    libraries: { setting: 'tokenLibraries', container: 'librariesList', removeClass: 'cert-lib-remove', icon: 'cpu', noun: 'library', empty: 'No token libraries' }
};

/** Initializes certificate store and token library management UI. */
export function initCertificatesSettings() {
    setupStoreManagement();
    setupLibraryManagement();
    setupCertificateDetection();
    setupRestoreDefaults();
    renderLists();
}

/** Sets up restore defaults buttons for stores and libraries. */
function setupRestoreDefaults() {
    document.getElementById('restoreDefaultStoresBtn')?.addEventListener('click', async () => {
        const defaults = await SignatureService.GetDefaultCertificateSources();
        setSetting('certificateStores', [...(defaults.system || []), ...(defaults.user || [])]);
        renderPathList(PATH_LISTS.stores);
        showToast('Default folders restored. Save to keep them.');
    });

    document.getElementById('restoreDefaultLibsBtn')?.addEventListener('click', async () => {
        setSetting('tokenLibraries', await SignatureService.GetDefaultTokenLibraries());
        renderPathList(PATH_LISTS.libraries);
        showToast('Default libraries restored. Save to keep them.');
    });
}

/** Sets up add certificate store button handler. */
function setupStoreManagement() {
    document.getElementById('addCertStoreBtn')?.addEventListener('click', async () => {
        try {
            const result = await App.OpenDirectoryDialog('Choose a certificate folder');
            if (result) addPath(PATH_LISTS.stores, result);
        } catch (error) {
            console.error('File dialog error:', error);
            showMessage('Try again in a moment.', 'Lankir couldn’t show the folder picker', 'error', { details: String(error?.message ?? error) });
        }
    });
}

/** Sets up add PKCS#11 library button handler. */
function setupLibraryManagement() {
    document.getElementById('addTokenLibBtn')?.addEventListener('click', async () => {
        try {
            const result = await App.OpenFileDialog(
                'Choose a PKCS#11 library',
                [
                    { DisplayName: 'Shared libraries (*.so, *.dll, *.dylib)', Pattern: '*.so;*.dll;*.dylib' },
                    { DisplayName: 'All files (*.*)', Pattern: '*.*' }
                ]
            );
            if (result) addPath(PATH_LISTS.libraries, result);
        } catch (error) {
            console.error('File dialog error:', error);
            showMessage('Try again in a moment.', 'Lankir couldn’t show the file picker', 'error', { details: String(error?.message ?? error) });
        }
    });
}

/** Adds a path to a list's setting unless it is already there. */
function addPath(list, path) {
    const paths = getSetting(list.setting) || [];
    if (paths.includes(path)) {
        showToast(`That ${list.noun} is already in the list`);
        return;
    }
    setSetting(list.setting, [...paths, path]);
    renderPathList(list);
}

function removePath(list, path) {
    setSetting(list.setting, (getSetting(list.setting) || []).filter((p) => p !== path));
    renderPathList(list);
}

/** Renders certificate stores, token libraries, and detected certificates. */
async function renderLists() {
    renderPathList(PATH_LISTS.stores);
    renderPathList(PATH_LISTS.libraries);
    await loadCertificates();
}

/** A path that truncates in the middle: the folder part shrinks, the last part stays whole. */
function renderPath(path) {
    const cut = path.lastIndexOf('/', path.length - 2) + 1;
    return `<span class="path" data-tip="${escapeAttr(path)}">`
        + `<span class="path-head">${escapeHtml(path.slice(0, cut))}</span>`
        + `<span class="path-tail">${escapeHtml(path.slice(cut))}</span></span>`;
}

/** Re-renders the stores and libraries lists, e.g. after the settings reload. */
export function renderPathLists() {
    renderPathList(PATH_LISTS.stores);
    renderPathList(PATH_LISTS.libraries);
}

function renderPathList(list) {
    const container = document.getElementById(list.container);
    if (!container) return;

    const paths = getSetting(list.setting) || [];
    if (paths.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>${list.empty}</p></div>`;
        return;
    }

    container.innerHTML = paths.map((path) => `
        <div class="list-row path-row">
            <span class="list-row-icon">${iconSvg(list.icon)}</span>
            ${renderPath(path)}
            <button class="icon-btn sm danger ${list.removeClass}" data-path="${escapeAttr(path)}" data-tip="Remove" aria-label="Remove ${escapeAttr(path)}">
                ${iconSvg('x', 'icon-sm')}
            </button>
        </div>
    `).join('');

    container.querySelectorAll(`.${list.removeClass}`).forEach((btn) => {
        btn.addEventListener('click', () => removePath(list, btn.dataset.path));
    });
}

function setupCertificateDetection() {
    document.getElementById('refreshCertsBtn')?.addEventListener('click', loadCertificates);
    document.getElementById('certificatesList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-copy]');
        if (btn) copyText(btn.dataset.copy, btn.closest('dd')?.querySelector('code'));
    });
}

/** Copies text; where the clipboard is not available, selects it for Ctrl C instead. */
export async function copyText(text, element) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied', { tone: 'success', timeout: 2000 });
    } catch {
        if (!element) return;
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

async function loadCertificates() {
    const container = document.getElementById('certificatesList');
    if (!container) return;

    const refreshBtn = document.getElementById('refreshCertsBtn');
    if (refreshBtn) refreshBtn.disabled = true;
    container.setAttribute('aria-busy', 'true');
    container.innerHTML = '<div class="empty-state"><div class="loading-spinner-small" id="certsLoadingSpinner"></div><p id="certsLoadingText">Looking for certificates…</p></div>';

    try {
        const certs = await SignatureService.ListCertificates();
        renderCertificates(certs);
    } catch (error) {
        console.error('Failed to list certificates:', error);
        container.innerHTML = `<div class="empty-state">${iconSvg('circle-alert')}<p>Could not look for certificates</p><p class="empty-state-detail">${escapeHtml(error?.message ?? String(error))}</p></div>`;
    } finally {
        container.removeAttribute('aria-busy');
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function renderCertificates(certs) {
    const container = document.getElementById('certificatesList');
    if (!container) return;

    if (!certs || certs.length === 0) {
        container.innerHTML = `<div class="empty-state">${iconSvg('shield-check')}<p>No certificates found</p><p class="empty-state-detail">Insert your card, or add the folder that holds your certificate file below.</p></div>`;
        return;
    }

    container.innerHTML = renderCertificateList(certs);
}
