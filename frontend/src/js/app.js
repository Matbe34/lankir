// Main Application Entry Point
// Initializes the PDF Editor application

import { initializeUI } from './ui.js';
import { updateStatus } from './utils.js';
import { loadRecentFilesWelcome } from './recentFiles.js';
import { openPDFFile, openRecentFile, setViewMode } from './pdfOperations.js';
import { signPDF } from './signature.js';
import { renderPage, changePage } from './renderer.js';
import { changeZoom } from './zoom.js';
import { switchToTab } from './pdfManager.js';
import { initMessageDialog } from './messageDialog.js';
import { initSettings } from './settings.js';

/**
 * Initialize application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
    initializeUI();
    initMessageDialog();
    await initSettings();
    updateStatus('Ready');
    loadRecentFilesWelcome();
    
    // Hide sidebars on initial load (home screen)
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const expandLeft = document.getElementById('expandLeft');
    const expandRight = document.getElementById('expandRight');
    
    if (leftSidebar) leftSidebar.style.display = 'none';
    if (rightSidebar) rightSidebar.style.display = 'none';
    if (expandLeft) expandLeft.style.display = 'none';
    if (expandRight) expandRight.style.display = 'none';

    // Global keyboard shortcuts
    document.addEventListener('keydown', async (e) => {
        try {
            // Don't intercept when user is typing in an input/textarea or contentEditable
            const active = document.activeElement;
            const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

            // Ctrl+Tab / Ctrl+Shift+Tab: switch between open tabs
            if (e.ctrlKey && e.key === 'Tab') {
                // Always move to the next tab (do not handle Ctrl+Shift+Tab)
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
                    console.error('Error switching tabs with Ctrl+Tab:', err);
                }
                return;
            }

            // Zoom in: Ctrl + '+' (also handle Ctrl+Shift+=' which produces '+')
            if (e.ctrlKey && !e.altKey && (e.key === '+' || e.key === '=')) {
                if (!isTyping) {
                    e.preventDefault();
                    const { changeZoom } = await import('./zoom.js');
                    changeZoom(0.1);
                }
                return;
            }

            // Zoom out: Ctrl + '-'
            if (e.ctrlKey && !e.altKey && e.key === '-') {
                if (!isTyping) {
                    e.preventDefault();
                    const { changeZoom } = await import('./zoom.js');
                    changeZoom(-0.1);
                }
                return;
            }

            // Open file: Ctrl + O
            if (e.ctrlKey && !e.altKey && e.key && e.key.toLowerCase() === 'o') {
                if (!isTyping) {
                    e.preventDefault();
                    const { openPDFFile } = await import('./pdfOperations.js');
                    openPDFFile();
                }
                return;
            }

            // Sign PDF: Alt + S
            if (e.altKey && !e.ctrlKey && e.key && e.key.toLowerCase() === 's') {
                if (!isTyping) {
                    e.preventDefault();
                    const { signPDF } = await import('./signature.js');
                    signPDF();
                }
                return;
            }

            // Escape: close visible modals (settings, profile, cert, placement, message)
            if (e.key === 'Escape') {
                // Order: signature placement overlay -> cert dialog -> profile dialog -> settings -> message dialog
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
                        } catch (_) {}
                    }
                    return;
                }

                // 4) Settings modal
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

                // 5) Generic message dialog
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
});

// Export API for potential external use or debugging
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
