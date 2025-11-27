import { showMessage } from './messageDialog.js';
import { initSignatureProfiles, loadSignatureProfiles } from './signatureProfiles.js';

const DEFAULT_SETTINGS = {
    theme: 'dark',
    accentColor: '#007acc',
    defaultZoom: 100,
    showLeftSidebar: true,
    showRightSidebar: false,
    recentFilesLength: 5,
    autosaveInterval: 0,
    debugMode: false,
    hardwareAccel: true
};

DEFAULT_SETTINGS.shortcuts = {
    openFile: 'Control+o',
    sign: 'Alt+s',
    zoomIn: 'Control+Plus',
    zoomOut: 'Control+Minus',
    nextTab: 'Control+Tab',
};

let currentSettings = { ...DEFAULT_SETTINGS };

export async function initSettings() {
    await loadSettings();
    setupSettingsModal();
    initSignatureProfiles();
}

async function loadSettings() {
    try {
        if (window.go && window.go.config && window.go.config.Service) {
            const backendSettings = await window.go.config.Service.Get();
            currentSettings = { ...DEFAULT_SETTINGS, ...backendSettings };
        } else {
            const stored = localStorage.getItem('pdfEditorSettings');
            if (stored) {
                currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
        }
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
        if (window.go && window.go.config && window.go.config.Service) {
            await window.go.config.Service.Update(currentSettings);
        }
        localStorage.setItem('pdfEditorSettings', JSON.stringify(currentSettings));
        applySettings();
        return true;
    } catch (error) {
        console.error('Failed to save settings:', error);
        try {
            localStorage.setItem('pdfEditorSettings', JSON.stringify(currentSettings));
            applySettings();
            return true;
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            return false;
        }
    }
}

/**
 * Apply current settings to the application
 */
function applySettings() {
    // Apply theme
    document.body.setAttribute('data-theme', currentSettings.theme);
    
    // Apply accent color
    document.documentElement.style.setProperty('--accent-blue', currentSettings.accentColor);
    
    // Other settings will be applied as needed by other modules
}

/**
 * Get a specific setting value
 */
export function getSetting(key) {
    return currentSettings[key];
}

/**
 * Get all settings
 */
export function getAllSettings() {
    return { ...currentSettings };
}

/**
 * Set a specific setting value
 */
export function setSetting(key, value) {
    currentSettings[key] = value;
}

/**
 * Setup settings modal
 */
function setupSettingsModal() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const settingsClose = document.getElementById('settingsModalClose');
    const settingsCancel = document.getElementById('settingsCancel');
    const settingsSave = document.getElementById('settingsSave');
    
    // Open settings
    settingsBtn.addEventListener('click', () => {
        openSettingsModal();
    });
    
    // Close settings
    const closeModal = () => {
        settingsModal.classList.add('hidden');
    };
    
    settingsClose.addEventListener('click', closeModal);
    settingsCancel.addEventListener('click', closeModal);
    
    // Save settings
    settingsSave.addEventListener('click', () => {
        if (saveSettingsFromModal()) {
            showMessage('Settings saved successfully', 'Success', 'success');
            closeModal();
        } else {
            showMessage('Failed to save settings', 'Error', 'error');
        }
    });
    
    // Setup tab navigation
    setupSettingsTabs();

    // Setup shortcut capture modal wiring
    const captureModal = document.getElementById('shortcutCaptureModal');
    const captureDisplay = document.getElementById('shortcutCaptureDisplay');
    const captureAction = document.getElementById('shortcutCaptureAction');
    const captureOk = document.getElementById('shortcutCaptureOk');
    const captureCancel = document.getElementById('shortcutCaptureCancel');
    const captureClose = document.getElementById('shortcutCaptureClose');

    // Helper to clean up capture listeners
    let captureKeyHandler = null;

    const closeCapture = () => {
        if (captureModal) captureModal.classList.add('hidden');
        captureDisplay && (captureDisplay.textContent = 'Waiting for input...');
        if (captureAction) captureAction.textContent = '';
        if (captureOk) captureOk.disabled = true;
        if (captureKeyHandler) {
            document.removeEventListener('keydown', captureKeyHandler, true);
            captureKeyHandler = null;
        }
    };

    // Build shortcut string from event
    const buildShortcutString = (ev) => {
        const parts = [];
        if (ev.ctrlKey) parts.push('Control');
        if (ev.altKey) parts.push('Alt');
        if (ev.shiftKey) parts.push('Shift');
        if (ev.metaKey) parts.push('Meta');

        let keyToken = ev.key;
        // Normalize some keys
        if (keyToken === '+' || keyToken === '=') keyToken = 'Plus';
        else if (keyToken === '-') keyToken = 'Minus';
        else if (keyToken === ' ') keyToken = 'Space';
        else if (keyToken === 'Esc') keyToken = 'Escape';

        // Ignore pure modifier presses (don't finalize until a non-mod key pressed)
        if (keyToken === 'Control' || keyToken === 'Shift' || keyToken === 'Alt' || keyToken === 'Meta') {
            return null;
        }

        // For long names, keep as-is (Tab, Escape, Enter, etc.). For single chars, lower-case them
        if (keyToken.length === 1) keyToken = keyToken.toLowerCase();

        parts.push(keyToken);
        return parts.join('+');
    };

    const shortcutInputs = document.querySelectorAll('#settingShortcutOpenFile, #settingShortcutSign, #settingShortcutZoomIn, #settingShortcutZoomOut, #settingShortcutNextTab');
    shortcutInputs.forEach(input => {
        if (!input) return;
        input.addEventListener('click', (ev) => {
            ev.preventDefault();
            // Open capture modal
            if (!captureModal) return;
            captureModal.classList.remove('hidden');
            captureDisplay && (captureDisplay.textContent = 'Press the shortcut now');

            // Show which action is being changed. Prefer a preceding <label> text if available.
            let actionName = '';
            try {
                const prev = input.previousElementSibling;
                if (prev && prev.tagName === 'LABEL') actionName = prev.textContent.trim();
            } catch (_) {}
            if (!actionName) {
                // Fallback mapping from input id
                const idMap = {
                    settingShortcutOpenFile: 'Open File',
                    settingShortcutSign: 'Sign Document',
                    settingShortcutZoomIn: 'Zoom In',
                    settingShortcutZoomOut: 'Zoom Out',
                    settingShortcutNextTab: 'Next Tab'
                };
                actionName = idMap[input.id] || input.id;
            }
            if (captureAction) captureAction.textContent = 'Changing: ' + actionName;
            if (captureOk) captureOk.disabled = true;

            let lastCaptured = null;

            // Handler captures the first non-modifier key press and updates display
            captureKeyHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // If user presses Escape while capturing we abort the capture
                if (e.key === 'Escape' || e.key === 'Esc') {
                    lastCaptured = null;
                    closeCapture();
                    return;
                }

                const val = buildShortcutString(e);
                if (val) {
                    lastCaptured = val;
                    captureDisplay.textContent = val;
                    if (captureOk) captureOk.disabled = false;
                } else {
                    // show current modifiers
                    const mods = [];
                    if (e.ctrlKey) mods.push('Control');
                    if (e.altKey) mods.push('Alt');
                    if (e.shiftKey) mods.push('Shift');
                    if (e.metaKey) mods.push('Meta');
                    captureDisplay.textContent = mods.length ? ('Modifiers: ' + mods.join('+') + ' — press another key') : 'Waiting for input...';
                    if (captureOk) captureOk.disabled = true;
                }
            };

            document.addEventListener('keydown', captureKeyHandler, true);

            const okHandler = () => {
                if (lastCaptured) input.value = lastCaptured;
                closeCapture();
                cleanupButtons();
            };

            const cancelHandler = () => {
                closeCapture();
                cleanupButtons();
            };

            const cleanupButtons = () => {
                captureOk.removeEventListener('click', okHandler);
                captureCancel.removeEventListener('click', cancelHandler);
                captureClose.removeEventListener('click', cancelHandler);
            };

            captureOk.addEventListener('click', okHandler);
            captureCancel.addEventListener('click', cancelHandler);
            captureClose.addEventListener('click', cancelHandler);
        });
    });
}

/**
 * Setup settings tabs navigation
 */
function setupSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const sections = document.querySelectorAll('.settings-section');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const sectionId = tab.getAttribute('data-section');

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active section
            sections.forEach(s => s.classList.remove('active'));
            const targetSection = document.getElementById(sectionId + 'Section');
            if (targetSection) {
                targetSection.classList.add('active');
            }

            if (sectionId === 'signatures') {
                loadSignatureProfiles();
            }
        });
    });
}

/**
 * Open settings modal and populate with current values
 */
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');

    document.getElementById('settingTheme').value = currentSettings.theme;
    document.getElementById('settingAccentColor').value = currentSettings.accentColor;
    document.getElementById('settingDefaultZoom').value = currentSettings.defaultZoom;
    document.getElementById('settingShowLeftSidebar').checked = currentSettings.showLeftSidebar;
    document.getElementById('settingShowRightSidebar').checked = currentSettings.showRightSidebar;
    document.getElementById('settingRecentFilesLength').value = currentSettings.recentFilesLength;
    document.getElementById('settingAutosaveInterval').value = currentSettings.autosaveInterval;
    document.getElementById('settingDebugMode').checked = currentSettings.debugMode;
    document.getElementById('settingHardwareAccel').checked = currentSettings.hardwareAccel;

    // Populate shortcuts inputs (if present)
    try {
        const sc = currentSettings.shortcuts || DEFAULT_SETTINGS.shortcuts;
        const map = {
            settingShortcutOpenFile: sc.openFile,
            settingShortcutSign: sc.sign,
            settingShortcutZoomIn: sc.zoomIn,
            settingShortcutZoomOut: sc.zoomOut,
            settingShortcutNextTab: sc.nextTab
        };
        Object.keys(map).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = map[id] || '';
        });
    } catch (e) {
        console.error('Failed to populate shortcuts inputs:', e);
    }

    modal.classList.remove('hidden');
}

/**
 * Save settings from modal form
 */
async function saveSettingsFromModal() {
    try {
        currentSettings.theme = document.getElementById('settingTheme').value;
        currentSettings.accentColor = document.getElementById('settingAccentColor').value;
        currentSettings.defaultZoom = parseInt(document.getElementById('settingDefaultZoom').value);
        currentSettings.showLeftSidebar = document.getElementById('settingShowLeftSidebar').checked;
        currentSettings.showRightSidebar = document.getElementById('settingShowRightSidebar').checked;
        currentSettings.recentFilesLength = parseInt(document.getElementById('settingRecentFilesLength').value);
        currentSettings.autosaveInterval = parseInt(document.getElementById('settingAutosaveInterval').value);
        currentSettings.debugMode = document.getElementById('settingDebugMode').checked;
        currentSettings.hardwareAccel = document.getElementById('settingHardwareAccel').checked;

        // Read shortcuts inputs if present
        try {
            currentSettings.shortcuts = currentSettings.shortcuts || {};
            const scOpen = document.getElementById('settingShortcutOpenFile');
            const scSign = document.getElementById('settingShortcutSign');
            const scZoomIn = document.getElementById('settingShortcutZoomIn');
            const scZoomOut = document.getElementById('settingShortcutZoomOut');
            const scNext = document.getElementById('settingShortcutNextTab');

            if (scOpen) currentSettings.shortcuts.openFile = scOpen.value || DEFAULT_SETTINGS.shortcuts.openFile;
            if (scSign) currentSettings.shortcuts.sign = scSign.value || DEFAULT_SETTINGS.shortcuts.sign;
            if (scZoomIn) currentSettings.shortcuts.zoomIn = scZoomIn.value || DEFAULT_SETTINGS.shortcuts.zoomIn;
            if (scZoomOut) currentSettings.shortcuts.zoomOut = scZoomOut.value || DEFAULT_SETTINGS.shortcuts.zoomOut;
            if (scNext) currentSettings.shortcuts.nextTab = scNext.value || DEFAULT_SETTINGS.shortcuts.nextTab;
        } catch (e) {
            console.error('Failed to read shortcuts inputs:', e);
        }

        return await saveSettings();
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

/**
 * Reset settings to defaults
 */
export async function resetSettings() {
    currentSettings = { ...DEFAULT_SETTINGS };
    await saveSettings();
}
