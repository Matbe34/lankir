import { initializeUI } from './ui.js';
import { updateStatus } from './utils.js';
import { loadRecentFilesWelcome } from './recentFiles.js';
import { openPDFFile, openRecentFile, setViewMode } from './pdfOperations.js';
import { signPDF } from './signature.js';
import { renderPage, changePage } from './renderer.js';
import { changeZoom } from './zoom.js';
import { switchToTab } from './pdfManager.js';
import { initMessageDialog } from './messageDialog.js';
import { initSettings, getSetting } from './settings.js';
import { themeManager } from './themeManager.js';


document.addEventListener('DOMContentLoaded', async () => {
    initializeUI();
    initMessageDialog();
    await initSettings();
    await themeManager.init();
    updateStatus('Ready');
    loadRecentFilesWelcome();

    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const expandLeft = document.getElementById('expandLeft');
    const expandRight = document.getElementById('expandRight');

    if (leftSidebar) leftSidebar.style.display = 'none';
    if (rightSidebar) rightSidebar.style.display = 'none';
    if (expandLeft) expandLeft.style.display = 'none';
    if (expandRight) expandRight.style.display = 'none';

    document.addEventListener('keydown', async (e) => {
        try {
            const active = document.activeElement;
            const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

            const cfg = getSetting('shortcuts') || {};

            const matchShortcut = (ev, shortcutStr) => {
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
                // Special aliases
                if (k === 'plus' || k === '+') {
                    return evKey === '+' || evKey === '=';
                }
                if (k === 'minus' || k === '-') {
                    return evKey === '-';
                }
                if (k === 'tab') return evKey === 'Tab';
                if (k === 'escape' || k === 'esc') return evKey === 'Escape' || evKey === 'Esc';
                // Single character keys
                return evKey.toLowerCase() === k;
            };

            // Next tab (Ctrl+Tab by default)
            if (matchShortcut(e, cfg.nextTab || 'Control+Tab')) {
                // Always move to next tab; ignore typing state
                e.preventDefault();
                try {
                    const { state } = await import('./state.js');
                    const { switchToTab } = await import('./pdfManager.js');

                    const tabIds = Array.from(state.openPDFs.keys());
                    if (tabIds.length === 0) return;

                    const currentIndex = tabIds.indexOf(state.activeTabId);
                    const nextIndex = (currentIndex === -1) ? 0 : (currentIndex + 1) % tabIds.length;
                    const nextTabId = tabIds[nextIndex];
                    if (nextTabId !== undefined) {
                        switchToTab(nextTabId);
                    }
                } catch (err) {
                    console.error('Error switching tabs with shortcut:', err);
                }
                return;
            }

            // Zoom in
            if (!isTyping && matchShortcut(e, cfg.zoomIn || 'Control+Plus')) {
                e.preventDefault();
                const { changeZoom } = await import('./zoom.js');
                changeZoom(0.1);
                return;
            }

            // Zoom out
            if (!isTyping && matchShortcut(e, cfg.zoomOut || 'Control+Minus')) {
                e.preventDefault();
                const { changeZoom } = await import('./zoom.js');
                changeZoom(-0.1);
                return;
            }

            // Open file
            if (!isTyping && matchShortcut(e, cfg.openFile || 'Control+o')) {
                e.preventDefault();
                const { openPDFFile } = await import('./pdfOperations.js');
                openPDFFile();
                return;
            }

            // Sign PDF
            if (!isTyping && matchShortcut(e, cfg.sign || 'Alt+s')) {
                e.preventDefault();
                const { signPDF } = await import('./signature.js');
                signPDF();
                return;
            }

            // Escape: always close current modal (special, not configurable)
            if (e.key === 'Escape' || e.key === 'Esc') {
                // Order: signature placement overlay -> cert dialog -> profile dialog -> profile editor -> settings -> message dialog
                // 1) Signature placement: trigger cancel button if present
                const placementOverlay = document.getElementById('signaturePlacementOverlay');
                if (placementOverlay && !placementOverlay.classList.contains('hidden')) {
                    const cancelBtn = document.getElementById('placementCancel');
                    if (cancelBtn) {
                        cancelBtn.click();
                        return;
                    }
                    // Fallback: hide overlay
                    placementOverlay.classList.add('hidden');
                    return;
                }

                // 2) Certificate dialog
                const certDialog = document.getElementById('certDialog');
                if (certDialog && !certDialog.classList.contains('hidden')) {
                    try {
                        const { closeCertificateDialog } = await import('./signature.js');
                        closeCertificateDialog();
                    } catch (e) {
                        certDialog.classList.add('hidden');
                    }
                    return;
                }

                // 3) Profile dialog
                const profileDialog = document.getElementById('profileDialog');
                if (profileDialog && !profileDialog.classList.contains('hidden')) {
                    const cancelBtn = document.getElementById('profileDialogCancel') || document.getElementById('profileDialogClose');
                    if (cancelBtn) {
                        cancelBtn.click();
                    } else {
                        profileDialog.classList.add('hidden');
                        // clear signature-related state if available
                        try {
                            const { state } = await import('./state.js');
                            state.selectedProfile = null;
                            state.pdfPath = null;
                        } catch (_) { }
                    }
                    return;
                }

                // 4) Profile editor modal (signature profile create/edit)
                const profileEditorModal = document.getElementById('profileEditorModal');
                if (profileEditorModal && !profileEditorModal.classList.contains('hidden')) {
                    const cancelBtn = document.getElementById('profileEditorCancel') || document.getElementById('profileEditorClose');
                    if (cancelBtn) {
                        cancelBtn.click();
                    } else {
                        profileEditorModal.classList.add('hidden');
                    }
                    return;
                }

                // 5) Settings modal
                const settingsModal = document.getElementById('settingsModal');
                if (settingsModal && !settingsModal.classList.contains('hidden')) {
                    const closeBtn = document.getElementById('settingsModalClose') || document.getElementById('settingsCancel');
                    if (closeBtn) {
                        closeBtn.click();
                    } else {
                        settingsModal.classList.add('hidden');
                    }
                    return;
                }

                // 6) Generic message dialog
                const messageDialog = document.getElementById('messageDialog');
                if (messageDialog && !messageDialog.classList.contains('hidden')) {
                    const closeBtn = document.getElementById('messageDialogClose') || document.getElementById('messageDialogOk');
                    if (closeBtn) {
                        closeBtn.click();
                    } else {
                        messageDialog.classList.add('hidden');
                    }
                    return;
                }
            }
        } catch (error) {
            // Swallow errors from keyboard handler to avoid breaking app
            console.error('Keyboard shortcut handler error:', error);
        }
    });

    document.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();

            const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;

            changeZoom(zoomDelta);
        }
    }, { passive: false });
});

window.pdfApp = {
    openPDFFile,
    signPDF,
    updateStatus,
    renderPage,
    changePage,
    changeZoom,
    loadRecentFilesWelcome,
    openRecentFile,
    setViewMode,
    switchToTab
};
