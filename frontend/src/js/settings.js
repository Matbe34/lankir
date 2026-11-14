import { showMessage } from './messageDialog.js';
import { showToast } from './toast.js';
import { iconSvg } from './icons.js';
import { formatShortcut, keycaps } from './shortcuts.js';
import { initSignatureProfiles, loadSignatureProfiles, closeProfileEditor } from './signatureProfiles.js';
import { themeManager } from './themeManager.js';
import { initCertificatesSettings, renderPathLists } from './certificates.js';
import { App, ConfigService } from './backend.js';
import { SETTINGS } from './constants.js';

const DEFAULT_SETTINGS = {
    theme: 'dark',
    accentColor: '#3b82f6',
    secondaryAccent: 'neutral',
    defaultZoom: 100,
    showLeftSidebar: false,
    showRightSidebar: false,
    recentFilesLength: 5,
    autosaveInterval: 0,
    debugMode: false,
    hardwareAccel: true,
    certificateStores: [],
    tokenLibraries: [],
    tsaUrl: '',
    signatureLocationLookup: false,
    checkRevocationOnline: true,
    lastCertificateFingerprint: '',
    lastSignatureProfileId: ''
};

DEFAULT_SETTINGS.shortcuts = {
    openFile: 'Control+o',
    sign: 'Alt+s',
    zoomIn: 'Control+Plus',
    zoomOut: 'Control+Minus',
    nextTab: 'Control+Tab',
    newWindow: 'Control+Shift+n',
    commandPalette: 'Control+k',
};

let currentSettings = { ...DEFAULT_SETTINGS };

/** Loads settings from backend/localStorage and initializes sub-modules. */
export async function initSettings() {
    await loadSettings();
    setupSettingsModal();
    initSignatureProfiles();
    initCertificatesSettings();
    await showVersion();
}

async function showVersion() {
    try {
        document.getElementById('settingAppVersion').textContent = await App.Version();
    } catch (error) {
        console.error('Failed to read the app version:', error);
    }
}

function readLocalSettings() {
    try {
        return JSON.parse(localStorage.getItem('pdfEditorSettings')) || {};
    } catch {
        return {};
    }
}

async function loadSettings() {
    // Init first so applySettings() applies the backend theme even when localStorage is empty.
    await themeManager.init();
    try {
        const backendSettings = await ConfigService.Get();
        // secondaryAccent and shortcuts aren't in the backend config; they persist only in localStorage.
        const local = readLocalSettings();
        currentSettings = {
            ...DEFAULT_SETTINGS,
            ...local,
            ...backendSettings,
            shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...local.shortcuts },
        };
        applySettings();
    } catch (error) {
        console.error('Failed to load settings:', error);
        try {
            const stored = localStorage.getItem('pdfEditorSettings');
            if (stored) {
                currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
            applySettings();
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
        }
    }
}

async function saveSettings() {
    try {
        await ConfigService.Update(currentSettings);
        localStorage.setItem('pdfEditorSettings', JSON.stringify(currentSettings));
        applySettings();
        return true;
    } catch (error) {
        console.error('Failed to save settings:', error);

        if (error.name === 'QuotaExceededError' || error.code === 22) {
            await showMessage(
                'The settings storage is full. Lower the number of recent files and try again.',
                'Lankir couldn’t save the settings',
                'error'
            );
            return false;
        }

        try {
            localStorage.setItem('pdfEditorSettings', JSON.stringify(currentSettings));
            applySettings();
            return true;
        } catch (e) {
            console.error('Failed to save to localStorage:', e);

            if (e.name === 'QuotaExceededError' || e.code === 22) {
                await showMessage(
                    'The settings storage is full. Lower the number of recent files and try again.',
                    'Lankir couldn’t save the settings',
                    'error'
                );
            }
            return false;
        }
    }
}

function applySettings() {
    if (themeManager.initialized) {
        themeManager.applyTheme(currentSettings.theme || 'dark');
        themeManager.applyAccentColor(currentSettings.accentColor || '#3b82f6');
        themeManager.applySecondaryAccent(currentSettings.secondaryAccent || 'neutral');
    }
    // Shortcut hints in menus and tooltips follow the shortcut settings.
    document.dispatchEvent(new CustomEvent('settings-applied'));

}

/** Returns the value of a specific setting by key. */
export function getSetting(key) {
    return currentSettings[key];
}

/** Sets one setting and saves all of them; resolves true when saved. */
export function saveSetting(key, value) {
    currentSettings[key] = value;
    return saveSettings();
}

/** Returns a copy of all current settings. */
export function getAllSettings() {
    return { ...currentSettings };
}

/** Updates a single setting value in memory (call saveSettings to persist). */
export function setSetting(key, value) {
    currentSettings[key] = value;
}

// The shortcut buttons on the Shortcuts page, by setting key.
const SHORTCUT_FIELDS = {
    openFile: { id: 'settingShortcutOpenFile', name: 'Open file' },
    sign: { id: 'settingShortcutSign', name: 'Sign document' },
    zoomIn: { id: 'settingShortcutZoomIn', name: 'Zoom in' },
    zoomOut: { id: 'settingShortcutZoomOut', name: 'Zoom out' },
    nextTab: { id: 'settingShortcutNextTab', name: 'Next tab' },
    newWindow: { id: 'settingShortcutNewWindow', name: 'New window' },
    commandPalette: { id: 'settingShortcutCommandPalette', name: 'All commands' },
};

// Fixed shortcuts the app handles itself (see onKeyDown in app.js).
const RESERVED_SHORTCUTS = {
    'control+s': 'Save',
    'control+shift+s': 'Save as',
    'control+w': 'Close tab',
    'control+f': 'Find',
    escape: 'closing dialogs',
};

/** Shows a shortcut string ("Control+o") as keycaps and keeps it as the element's value. */
function setShortcutButton(button, shortcut) {
    button.value = shortcut;
    button.replaceChildren(keycaps(formatShortcut(shortcut)));
    const label = document.querySelector(`label[for="${button.id}"]`)?.textContent.trim() || '';
    button.setAttribute('aria-label', `${label}: ${formatShortcut(shortcut).join(' ')}. Change`);
}

/** "Control+o" from a keydown, or null while only modifiers are held. */
function buildShortcutString(ev) {
    const parts = [];
    if (ev.ctrlKey) parts.push('Control');
    if (ev.altKey) parts.push('Alt');
    if (ev.shiftKey) parts.push('Shift');
    if (ev.metaKey) parts.push('Meta');

    let keyToken = ev.key;
    if (keyToken === '+' || keyToken === '=') keyToken = 'Plus';
    else if (keyToken === '-') keyToken = 'Minus';
    else if (keyToken === ' ') keyToken = 'Space';
    else if (keyToken === 'Esc') keyToken = 'Escape';

    if (keyToken === 'Control' || keyToken === 'Shift' || keyToken === 'Alt' || keyToken === 'Meta') {
        return null;
    }

    if (keyToken.length === 1) keyToken = keyToken.toLowerCase();

    parts.push(keyToken);
    return parts.join('+');
}

/** What already uses a shortcut, other than the button being changed, or ''. */
function shortcutConflict(shortcut, button) {
    const key = shortcut.toLowerCase();
    for (const { id, name } of Object.values(SHORTCUT_FIELDS)) {
        const other = document.getElementById(id);
        if (other && other !== button && other.value.toLowerCase() === key) return `Already used by ${name}`;
    }
    if (RESERVED_SHORTCUTS[key]) return `Kept for ${RESERVED_SHORTCUTS[key]}`;
    return '';
}

function setupShortcutCapture() {
    const captureModal = document.getElementById('shortcutCaptureModal');
    const captureDisplay = document.getElementById('shortcutCaptureDisplay');
    const captureAction = document.getElementById('shortcutCaptureAction');
    const captureStatus = document.getElementById('shortcutCaptureStatus');
    const captureOk = document.getElementById('shortcutCaptureOk');
    const captureCancel = document.getElementById('shortcutCaptureCancel');
    const captureClose = document.getElementById('shortcutCaptureClose');
    if (!captureModal) return;

    let target = null;
    let captured = null;

    const showKeys = (keys, state) => {
        captureDisplay.replaceChildren(keycaps(keys));
        captureDisplay.dataset.state = state;
    };
    const setStatus = (text, tone = '') => {
        captureStatus.innerHTML = tone === 'warning' ? iconSvg('triangle-alert', 'icon-sm') : '';
        captureStatus.append(text);
        captureStatus.dataset.tone = tone;
    };

    const onKey = (e) => {
        // Tab still moves focus, so the dialog's buttons stay reachable by keyboard.
        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
        // Enter and Space press a focused Cancel, Save or close button.
        const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
        if (plain && (e.key === 'Enter' || e.key === ' ') && document.activeElement?.matches('#shortcutCaptureModal button')) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape' || e.key === 'Esc') {
            close();
            return;
        }
        if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && captured) {
            if (!captureOk.disabled) captureOk.click();
            return;
        }

        const value = buildShortcutString(e);
        if (!value) {
            const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
            showKeys(formatShortcut(mods.join('+')), 'partial');
            setStatus('Now press a key');
            captured = null;
            captureOk.disabled = true;
            return;
        }

        captured = value;
        const same = value.toLowerCase() === target.value.toLowerCase();
        const conflict = same ? '' : shortcutConflict(value, target);
        showKeys(formatShortcut(value), same ? 'current' : 'new');
        setStatus(same ? 'Current shortcut' : conflict, conflict ? 'warning' : '');
        captureOk.disabled = same || Boolean(conflict);
    };

    const close = () => {
        captureModal.classList.add('hidden');
        document.removeEventListener('keydown', onKey, true);
        const button = target;
        target = null;
        captured = null;
        button?.focus();
    };

    const open = (button) => {
        target = button;
        captured = null;
        const field = Object.values(SHORTCUT_FIELDS).find((f) => f.id === button.id);
        captureAction.replaceChildren('Press the new shortcut for ', Object.assign(document.createElement('strong'), { textContent: field?.name || button.id }), '.');
        showKeys(formatShortcut(button.value), 'current');
        setStatus('Current shortcut');
        captureOk.disabled = true;
        captureModal.classList.remove('hidden');
        document.addEventListener('keydown', onKey, true);
        captureModal.querySelector('.capture-modal')?.focus();
    };

    captureOk.addEventListener('click', () => {
        if (target && captured) setShortcutButton(target, captured);
        close();
    });
    captureCancel.addEventListener('click', close);
    captureClose.addEventListener('click', close);

    for (const { id } of Object.values(SHORTCUT_FIELDS)) {
        document.getElementById(id)?.addEventListener('click', (ev) => {
            ev.preventDefault();
            open(ev.currentTarget);
        });
    }
}

/** Marks the edges of a scrolling area that have more content beyond them (for the edge shadows). */
function watchScrollEdges(area) {
    const update = () => {
        area.toggleAttribute('data-more-above', area.scrollTop > 0);
        area.toggleAttribute('data-more-below', area.scrollTop + area.clientHeight < area.scrollHeight - 1);
    };
    area.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(update);
        observer.observe(area);
        for (const child of area.children) observer.observe(child);
    }
    update();
    return update;
}

// The certificate folders and libraries are edited in place (certificates.js);
// Cancel puts back what they were when the dialog opened.
let pathsWhenOpened = null;

function setupSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');

    document.getElementById('settingsBtn')?.addEventListener('click', () => openSettings());

    const closeModal = ({ discard = true } = {}) => {
        closeProfileEditor();
        if (discard && pathsWhenOpened) {
            Object.assign(currentSettings, pathsWhenOpened);
            renderPathLists();
        }
        pathsWhenOpened = null;
        settingsModal.classList.add('hidden');
    };

    document.getElementById('settingsModalClose').addEventListener('click', () => closeModal());
    document.getElementById('settingsCancel').addEventListener('click', () => closeModal());

    const saveBtn = document.getElementById('settingsSave');
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
            if (await saveSettingsFromModal()) {
                closeModal({ discard: false });
                showToast('Settings saved', { tone: 'success' });
            } else {
                showMessage('Something went wrong while saving them. Try again.', 'Lankir couldn’t save the settings', 'error');
            }
        } finally {
            saveBtn.disabled = false;
        }
    });

    setupSettingsTabs();
    setupShortcutCapture();

    for (const area of settingsModal.querySelectorAll('[data-scroll-edges]')) {
        const update = watchScrollEdges(area);
        settingsModal.addEventListener('settings-page-shown', update);
    }
}

function showSection(sectionId) {
    const tabs = document.querySelectorAll('.settings-tab');
    let label = '';
    tabs.forEach((t) => {
        const active = t.getAttribute('data-section') === sectionId;
        t.classList.toggle('active', active);
        if (active) {
            t.setAttribute('aria-current', 'page');
            label = t.textContent.trim();
        } else {
            t.removeAttribute('aria-current');
        }
    });

    document.querySelectorAll('.settings-section').forEach((s) => {
        s.classList.toggle('active', s.id === sectionId + 'Section');
    });

    const title = document.getElementById('settingsPageTitle');
    if (title && label) title.textContent = label;

    const body = document.querySelector('#settingsMain .prefs-body');
    if (body) body.scrollTop = 0;
    document.getElementById('settingsModal')?.dispatchEvent(new Event('settings-page-shown'));

    if (sectionId === 'signatures') {
        loadSignatureProfiles();
    }
}

function setupSettingsTabs() {
    document.querySelectorAll('.settings-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            // inert already blocks this where the webview supports it (WebKitGTK 2.38+).
            if (tab.closest('[inert]')) return;
            showSection(tab.getAttribute('data-section'));
        });
    });
}

/** Opens the settings dialog, optionally on a section such as 'certificates'. */
export function openSettings(section) {
    const modal = document.getElementById('settingsModal');

    document.getElementById('settingTheme').value = currentSettings.theme;
    document.getElementById('settingAccentColor').value = currentSettings.accentColor;
    document.getElementById('settingSecondaryAccent').value = currentSettings.secondaryAccent || 'neutral';
    document.getElementById('settingDefaultZoom').value = currentSettings.defaultZoom;
    document.getElementById('settingShowLeftSidebar').checked = currentSettings.showLeftSidebar;
    document.getElementById('settingShowRightSidebar').checked = currentSettings.showRightSidebar;
    document.getElementById('settingRecentFilesLength').value = currentSettings.recentFilesLength;
    document.getElementById('settingDebugMode').checked = currentSettings.debugMode;
    document.getElementById('settingHardwareAccel').checked = currentSettings.hardwareAccel;
    document.getElementById('settingTsaUrl').value = currentSettings.tsaUrl || '';
    document.getElementById('settingSignatureLocationLookup').checked = currentSettings.signatureLocationLookup;
    document.getElementById('settingCheckRevocationOnline').checked = currentSettings.checkRevocationOnline;

    const sc = { ...DEFAULT_SETTINGS.shortcuts, ...currentSettings.shortcuts };
    for (const [key, { id }] of Object.entries(SHORTCUT_FIELDS)) {
        const el = document.getElementById(id);
        if (el) setShortcutButton(el, sc[key] || '');
    }

    pathsWhenOpened = {
        certificateStores: currentSettings.certificateStores,
        tokenLibraries: currentSettings.tokenLibraries,
    };
    renderPathLists();
    closeProfileEditor();

    modal.classList.remove('hidden');
    const active = document.querySelector('.settings-tab.active')?.getAttribute('data-section') || 'appearance';
    showSection(section || active);
}

async function saveSettingsFromModal() {
    try {
        currentSettings.theme = document.getElementById('settingTheme').value;
        currentSettings.accentColor = document.getElementById('settingAccentColor').value;
        currentSettings.secondaryAccent = document.getElementById('settingSecondaryAccent').value;

        // A changed value outside the limits goes to the nearest one; an older
        // file's value outside them stays until it is changed.
        const within = (id, { MIN, MAX }, stored) => {
            const input = document.getElementById(id);
            // Number(), not parseInt: a number field accepts exponents such as 1e3.
            const value = input.value.trim() === '' ? NaN : Math.trunc(Number(input.value));
            if (input.value === String(stored) || Number.isNaN(value)) return stored;
            return Math.min(MAX, Math.max(MIN, value));
        };
        currentSettings.defaultZoom = within('settingDefaultZoom', SETTINGS.ZOOM, currentSettings.defaultZoom);

        currentSettings.showLeftSidebar = document.getElementById('settingShowLeftSidebar').checked;
        currentSettings.showRightSidebar = document.getElementById('settingShowRightSidebar').checked;

        currentSettings.recentFilesLength = within('settingRecentFilesLength', SETTINGS.RECENT_FILES, currentSettings.recentFilesLength);

        currentSettings.debugMode = document.getElementById('settingDebugMode').checked;
        currentSettings.hardwareAccel = document.getElementById('settingHardwareAccel').checked;
        currentSettings.tsaUrl = document.getElementById('settingTsaUrl').value.trim();
        currentSettings.signatureLocationLookup = document.getElementById('settingSignatureLocationLookup').checked;
        currentSettings.checkRevocationOnline = document.getElementById('settingCheckRevocationOnline').checked;

        // certificateStores and tokenLibraries are updated via setSetting in certificates.js

        try {
            currentSettings.shortcuts = currentSettings.shortcuts || {};
            for (const [key, { id }] of Object.entries(SHORTCUT_FIELDS)) {
                const el = document.getElementById(id);
                if (el) currentSettings.shortcuts[key] = el.value || DEFAULT_SETTINGS.shortcuts[key];
            }
        } catch (e) {
            console.error('Failed to read shortcuts inputs:', e);
        }

        return await saveSettings();
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

export async function resetSettings() {
    currentSettings = { ...DEFAULT_SETTINGS };
    await saveSettings();
}
