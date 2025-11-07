// Settings Module
// Handles application settings and preferences

import { showMessage } from './messageDialog.js';

/**
 * Default settings
 */
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

/**
 * Current settings (loaded from storage or defaults)
 */
let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Initialize settings module
 */
export async function initSettings() {
    await loadSettings();
    setupSettingsModal();
}

/**
 * Load settings from backend
 */
async function loadSettings() {
    try {
        // Try to load from backend first
        if (window.go && window.go.config && window.go.config.Service) {
            const backendSettings = await window.go.config.Service.Get();
            currentSettings = { ...DEFAULT_SETTINGS, ...backendSettings };
        } else {
            // Fallback to localStorage for web version
            const stored = localStorage.getItem('pdfEditorSettings');
            if (stored) {
                currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
        }
        applySettings();
    } catch (error) {
        console.error('Failed to load settings:', error);
        // Fallback to localStorage
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

/**
 * Save settings to backend and localStorage
 */
async function saveSettings() {
    try {
        // Save to backend if available
        if (window.go && window.go.config && window.go.config.Service) {
            await window.go.config.Service.Update(currentSettings);
        }
        // Also save to localStorage as backup
        localStorage.setItem('pdfEditorSettings', JSON.stringify(currentSettings));
        applySettings();
        return true;
    } catch (error) {
        console.error('Failed to save settings:', error);
        // Fallback to localStorage only
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
        });
    });
}

/**
 * Open settings modal and populate with current values
 */
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    
    // Populate form with current settings
    document.getElementById('settingTheme').value = currentSettings.theme;
    document.getElementById('settingAccentColor').value = currentSettings.accentColor;
    document.getElementById('settingDefaultZoom').value = currentSettings.defaultZoom;
    document.getElementById('settingShowLeftSidebar').checked = currentSettings.showLeftSidebar;
    document.getElementById('settingShowRightSidebar').checked = currentSettings.showRightSidebar;
    document.getElementById('settingRecentFilesLength').value = currentSettings.recentFilesLength;
    document.getElementById('settingAutosaveInterval').value = currentSettings.autosaveInterval;
    document.getElementById('settingDebugMode').checked = currentSettings.debugMode;
    document.getElementById('settingHardwareAccel').checked = currentSettings.hardwareAccel;
    
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
