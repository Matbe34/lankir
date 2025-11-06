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

/**
 * Initialize application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    initMessageDialog();
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
