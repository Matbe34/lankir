import { Events } from '@wailsio/runtime';
import { initializeUI } from './ui.js';
import { updateStatus } from './utils.js';
import { loadRecentFilesWelcome } from './recentFiles.js';
import {
    openPDFFile, switchToNextTab, closeTab, saveTab, handleCloseRequested
} from './documents.js';
import { initCommandPalette, openCommandPalette, closeCommandPalette, isCommandPaletteOpen } from './commandPalette.js';
import { signPDF, closeSignPanel } from './signature.js';
import { zoomIn, zoomOut, handleZoomWheel, handleNavigationKey } from './navigation.js';
import { initFindBar, openFindBar, closeFindBar } from './findBar.js';
import { initAnnotationToolbar, handleEditCommand } from './annotationToolbar.js';
import { initMessageDialog } from './messageDialog.js';
import { initSettings, getSetting } from './settings.js';
import { initLoadingIndicator } from './loadingIndicator.js';
import { getActivePDF } from './state.js';
import { initFileOpening } from './fileOpener.js';
import { App } from './backend.js';
import { hydrateIcons } from './icons.js';
import { initTooltips } from './tooltip.js';
import { renderShortcutHints } from './shortcuts.js';
import { closeOpenMenu } from './menus.js';

/** In debug mode, copy console output and uncaught errors to the Go log. */
function forwardConsoleToGo() {
    const format = (args) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    for (const level of ['log', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            App.LogFrontend(level, format(args)).catch(() => {});
        };
    }
    window.addEventListener('error', (e) => App.LogFrontend('error', `${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {}));
    window.addEventListener('unhandledrejection', (e) => App.LogFrontend('error', `unhandled rejection: ${e.reason?.stack || e.reason}`).catch(() => {}));
}

/** Parses "Control+Shift+n"-style shortcut strings from the settings. */
function matchShortcut(ev, shortcutStr) {
    if (!shortcutStr) return false;
    const parts = shortcutStr.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return false;

    let needCtrl = false;
    let needAlt = false;
    let needShift = false;
    let needMeta = false;
    let keyToken = null;

    parts.forEach(part => {
        const lower = part.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') needCtrl = true;
        else if (lower === 'alt') needAlt = true;
        else if (lower === 'shift') needShift = true;
        else if (lower === 'meta' || lower === 'cmd' || lower === 'super') needMeta = true;
        else keyToken = part; // last non-mod token wins
    });

    if (ev.ctrlKey !== needCtrl) return false;
    if (ev.altKey !== needAlt) return false;
    if (ev.shiftKey !== needShift) return false;
    if (ev.metaKey !== needMeta) return false;

    if (!keyToken) return true; // only modifiers

    const k = keyToken.toLowerCase();
    const evKey = ev.key;
    if (k === 'plus' || k === '+') return evKey === '+' || evKey === '=';
    if (k === 'minus' || k === '-') return evKey === '-';
    if (k === 'tab') return evKey === 'Tab';
    if (k === 'escape' || k === 'esc') return evKey === 'Escape' || evKey === 'Esc';
    return evKey.toLowerCase() === k;
}

/** Escape closes the topmost open menu, dialog or overlay. */
function closeTopDialog() {
    // The palette is above everything, and its Escape lands here once focus has left its field.
    if (isCommandPaletteOpen()) {
        closeCommandPalette();
        return;
    }
    if (closeOpenMenu({ focusButton: true })) return;
    const visible = (id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden') ? el : null;
    };
    if (visible('profileEditorModal')) {
        (document.getElementById('profileEditorCancel') || document.getElementById('profileEditorClose'))?.click();
        return;
    }
    if (visible('settingsModal')) {
        (document.getElementById('settingsModalClose') || document.getElementById('settingsCancel'))?.click();
        return;
    }
    if (visible('signPanel')) {
        closeSignPanel();
        return;
    }
    if (visible('findBar')) {
        closeFindBar();
    }
}

const isDialogOpen = () => document.querySelector('.modal-overlay:not(.hidden), #signPanel:not(.hidden)') !== null;

async function onKeyDown(e) {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
    const cfg = getSetting('shortcuts') || {};
    const tab = getActivePDF();
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape' || e.key === 'Esc') {
        closeTopDialog();
        return;
    }
    if (matchShortcut(e, cfg.commandPalette || 'Control+k')) {
        e.preventDefault();
        if (isCommandPaletteOpen()) closeCommandPalette();
        else if (!isDialogOpen()) openCommandPalette();
        return;
    }
    if (isDialogOpen()) return;

    if (matchShortcut(e, cfg.nextTab || 'Control+Tab')) {
        e.preventDefault();
        switchToNextTab();
        return;
    }
    if (!isTyping && matchShortcut(e, cfg.zoomIn || 'Control+Plus')) {
        e.preventDefault();
        zoomIn();
        return;
    }
    if (!isTyping && matchShortcut(e, cfg.zoomOut || 'Control+Minus')) {
        e.preventDefault();
        zoomOut();
        return;
    }
    if (!isTyping && matchShortcut(e, cfg.openFile || 'Control+o')) {
        e.preventDefault();
        openPDFFile();
        return;
    }
    if (matchShortcut(e, cfg.newWindow || 'Control+Shift+n')) {
        e.preventDefault();
        App.OpenInNewWindow(tab?.filePath ?? '').catch(err => console.error('OpenInNewWindow failed:', err));
        return;
    }
    if (!isTyping && matchShortcut(e, cfg.sign || 'Alt+s')) {
        e.preventDefault();
        signPDF();
        return;
    }
    if (!tab) return;

    if (ctrl && key === 'f') {
        e.preventDefault();
        openFindBar();
        return;
    }
    if (ctrl && key === 's') {
        e.preventDefault();
        saveTab(tab.id, { saveAs: e.shiftKey });
        return;
    }
    if (ctrl && !e.shiftKey && key === 'w') {
        e.preventDefault();
        closeTab(tab.id);
        return;
    }
    // A focused control that already used the key (e.g. arrows between panel segments) keeps it.
    if (isTyping || e.defaultPrevented) return;
    if (handleNavigationKey(e)) e.preventDefault();
}

// pdf.js' editor manager handles copy/cut/paste on the whole document and calls
// preventDefault, which swallowed clipboard use in our text fields and PDF form fields.
function keepClipboardInTextFields() {
    const isTextField = (el) => el instanceof Element
        && (el.matches('input, textarea, select') || el.isContentEditable)
        && !el.closest('.annotationEditorLayer');
    for (const type of ['copy', 'cut', 'paste']) {
        document.body.addEventListener(type, (e) => {
            if (isTextField(e.target)) e.stopPropagation();
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    keepClipboardInTextFields();
    hydrateIcons();
    initTooltips();
    initializeUI();
    initMessageDialog();
    initLoadingIndicator();
    initCommandPalette();
    initFindBar();
    initAnnotationToolbar();
    document.addEventListener('settings-applied', () => renderShortcutHints());
    await initSettings();
    renderShortcutHints();
    if (getSetting('debugMode')) forwardConsoleToGo();
    updateStatus('Ready');
    loadRecentFilesWelcome();

    Events.On('close-requested', () => handleCloseRequested());
    Events.On('edit-command', ({ data }) => handleEditCommand(data, { dialogOpen: isDialogOpen() }));
    initFileOpening();

    document.addEventListener('keydown', (e) => {
        onKeyDown(e).catch(err => console.error('Keyboard shortcut handler error:', err));
    });
    document.addEventListener('wheel', handleZoomWheel, { passive: false });
});
