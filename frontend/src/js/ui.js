import { state, getActivePDF } from './state.js';
import { openPDFFile, saveTab, closeTab, switchToHome, switchToTab } from './documents.js';
import { signPDF } from './signature.js';
import { zoomIn, zoomOut, setZoom, setZoomFromInput, goToPage, nextPage, previousPage } from './navigation.js';
import { openFindBar, closeFindBar } from './findBar.js';
import { fillRecentMenu } from './recentFiles.js';
import { openSettings } from './settings.js';
import { bindMenu } from './menus.js';
import { App } from './backend.js';
import { initTabStrip } from './tabStrip.js';
import { updatePageRoom } from './pageRoom.js';
import { initPanelResize } from './panelResize.js';
import { syncDocumentMenu } from './documentTools.js';

const $ = (id) => document.getElementById(id);
const on = (id, type, handler) => $(id)?.addEventListener(type, handler);
const withActiveTab = (fn) => () => {
    if (state.activeTabId) fn(state.activeTabId);
};

/** Binds the header, page pill and menus to their actions. */
export function setupEventListeners() {
    on('openBtn', 'click', () => openPDFFile());
    on('welcomeOpenBtn', 'click', () => openPDFFile());
    on('signBtn', 'click', () => signPDF());
    on('sidePanelBtn', 'click', () => setSidePanel($('sidePanel').classList.contains('hidden')));
    on('findBtn', 'click', () => ($('findBar').classList.contains('hidden') ? openFindBar() : closeFindBar()));

    on('saveBtn', 'click', withActiveTab((id) => saveTab(id)));
    on('saveAsBtn', 'click', withActiveTab((id) => saveTab(id, { saveAs: true })));
    on('closeTabBtn', 'click', withActiveTab((id) => closeTab(id)));
    on('newWindowBtn', 'click', () => {
        App.OpenInNewWindow(getActivePDF()?.filePath ?? '').catch((err) => console.error('OpenInNewWindow failed:', err));
    });
    on('shortcutsBtn', 'click', () => openSettings('shortcuts'));

    const recentMenu = $('recentMenu');
    if (recentMenu) {
        bindMenu($('recentBtn'), recentMenu, { anchor: $('openBtn'), onOpen: () => fillRecentMenu(recentMenu) });
    }
    const mainMenu = $('mainMenu');
    if (mainMenu) {
        bindMenu($('mainMenuBtn'), mainMenu, {
            onOpen: () => {
                for (const item of mainMenu.querySelectorAll('[data-needs-doc]')) item.disabled = !getActivePDF();
                syncDocumentMenu();
            }
        });
    }
    const zoomMenu = $('zoomMenu');
    if (zoomMenu) {
        bindMenu($('zoomMenuBtn'), zoomMenu, {
            anchor: zoomMenu.previousElementSibling?.querySelector('.zoom-control'),
            onOpen: () => {
                const current = getActivePDF()?.view?.pdfViewer?.currentScaleValue;
                for (const item of zoomMenu.querySelectorAll('[data-zoom]')) {
                    item.setAttribute('aria-checked', String(String(current) === item.dataset.zoom));
                }
            }
        });
        for (const item of zoomMenu.querySelectorAll('[data-zoom]')) {
            item.addEventListener('click', () => setZoom(item.dataset.zoom));
        }
    }

    const pageInput = $('pageInput');
    pageInput?.addEventListener('change', () => goToPage(pageInput.value));
    pageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            goToPage(pageInput.value);
            pageInput.blur();
        }
    });
    pageInput?.addEventListener('focus', () => pageInput.select());
    on('nextPageBtn', 'click', nextPage);
    on('prevPageBtn', 'click', previousPage);
    on('zoomInBtn', 'click', zoomIn);
    on('zoomOutBtn', 'click', zoomOut);

    const zoomInput = $('zoomInput');
    zoomInput?.addEventListener('change', () => setZoomFromInput(zoomInput.value));
    zoomInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            setZoomFromInput(zoomInput.value);
            zoomInput.blur();
        }
    });
    zoomInput?.addEventListener('focus', () => zoomInput.select());
}

/** Binds the side panel's Pages / Outline / Signatures segments; arrow keys move between them. */
export function setupTabs() {
    for (const btn of document.querySelectorAll('.tab-btn')) {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const shown = [...document.querySelectorAll('.tab-btn:not([hidden])')];
            const next = shown[(shown.indexOf(btn) + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length];
            e.preventDefault();
            next.click();
            next.focus();
        });
    }
}

/** Shows one segment of the side panel and remembers it for the active tab. */
export function switchTab(tabName) {
    for (const btn of document.querySelectorAll('.tab-btn')) {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
    }
    for (const content of document.querySelectorAll('.tab-content')) {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    }
    const tab = getActivePDF();
    if (tab) tab.panelTab = tabName;
}

/** Opens or closes the side panel and remembers it for the active tab. */
export function setSidePanel(open) {
    $('sidePanel')?.classList.toggle('hidden', !open);
    $('sidePanelBtn')?.setAttribute('aria-pressed', String(open));
    const tab = getActivePDF();
    if (tab) tab.panelOpen = open;
    updatePageRoom();
}

/** Closes the side panel without touching any tab's remembered state. */
export function hideSidebars() {
    $('sidePanel')?.classList.add('hidden');
    const btn = $('sidePanelBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', 'false');
    // The start page keeps the toggle in place, off, so the header doesn't change shape.
    btn.disabled = !getActivePDF();
}

/** Shows the side panel the way the active tab last had it. */
export function showSidebars() {
    const tab = getActivePDF();
    const btn = $('sidePanelBtn');
    if (btn) btn.disabled = !tab;
    if (!tab) {
        hideSidebars();
        return;
    }
    switchTab(tab.panelTab || 'pages');
    setSidePanel(Boolean(tab.panelOpen));
}

/** Initializes all UI event handlers on application startup. */
export function initializeUI() {
    setupEventListeners();
    setupTabs();
    initTabStrip({ onSelect: (id) => switchToTab(id) });
    initPanelResize();
    hideSidebars();
}
