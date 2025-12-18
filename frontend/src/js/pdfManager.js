import { state, getActivePDF, getNextTabId, addOpenPDF, removeOpenPDF, setActiveTab, createPDFData } from './state.js';
import { updateStatus, updatePageIndicator, updateScrollProgress, escapeHtml, sanitizeError } from './utils.js';
import { showSidebars, hideSidebars } from './ui.js';
import { renderCachedPDF, cleanupScrollListeners } from './renderer.js';
import { updateUIForPDF, reloadPDFInBackend, reloadPDFInBackendAsync } from './pdfOperations.js';
import { updateCurrentPageFromScroll, lazyLoadVisiblePages, loadVisiblePages, cancelBackgroundLoading } from './pageLoader.js';
import { stateEmitter, StateEvents } from './eventEmitter.js';

let tabSwitchInProgress = false;
let pendingTabSwitch = null;

/** Creates a new tab for a PDF and returns its tab ID. */
export function createPDFTab(filePath, metadata) {
    const tabId = getNextTabId();
    const pdfData = createPDFData(tabId, filePath, metadata);
    
    // Initialize sidebar states from settings
    const settings = JSON.parse(localStorage.getItem('pdfEditorSettings') || '{}');
    pdfData.leftSidebarCollapsed = !settings.showLeftSidebar;
    pdfData.rightSidebarCollapsed = !settings.showRightSidebar;
    
    // Add to open PDFs
    addOpenPDF(tabId, pdfData);
    
    // Create tab element
    const tabsContainer = document.getElementById('pdfTabsContainer');
    const tab = document.createElement('div');
    tab.className = 'pdf-tab';
    tab.dataset.tabId = tabId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'pdfViewer');
    tab.setAttribute('tabindex', '0');
    
    tab.innerHTML = `
        <span class="pdf-tab-name" title="${escapeHtml(pdfData.fileName)}">${escapeHtml(pdfData.fileName)}</span>
        <button class="pdf-tab-close" title="Close" aria-label="Close ${escapeHtml(pdfData.fileName)}">×</button>
    `;
    
    // Tab click handler
    tab.addEventListener('click', (e) => {
        if (!e.target.classList.contains('pdf-tab-close')) {
            switchToTab(tabId);
        }
    });
    
    // Keyboard support for tab
    tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            switchToTab(tabId);
        }
    });
    
    // Close button handler
    tab.querySelector('.pdf-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closePDFTab(tabId);
    });
    
    tabsContainer.appendChild(tab);
    tabsContainer.classList.add('has-tabs');
    
    // Emit event
    stateEmitter.emit(StateEvents.PDF_OPENED, { tabId, filePath, metadata });
    
    return tabId;
}

/** Switches to a different PDF tab by ID. */
export async function switchToTab(tabId) {
    if (tabSwitchInProgress) {
        console.log(`Tab switch already in progress, queuing switch to ${tabId}`);
        pendingTabSwitch = tabId;
        return;
    }
    
    tabSwitchInProgress = true;
    
    try {
        // Save current tab state before switching
        if (state.activeTabId) {
        const currentPDF = state.openPDFs.get(state.activeTabId);
        if (currentPDF) {
            const viewer = document.getElementById('pdfViewer');
            const pageList = document.getElementById('pageList');
            const leftSidebar = document.getElementById('leftSidebar');
            const rightSidebar = document.getElementById('rightSidebar');
            
            currentPDF.viewerHTML = viewer.innerHTML;
            currentPDF.pageListHTML = pageList.innerHTML;
            currentPDF.scrollPosition = viewer.scrollTop;
            currentPDF.zoomLevel = state.zoomLevel;
            currentPDF.leftSidebarCollapsed = leftSidebar.classList.contains('collapsed');
            currentPDF.rightSidebarCollapsed = rightSidebar.classList.contains('collapsed');
        }
    }
    
    // Deactivate all tabs
    document.querySelectorAll('.pdf-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
    });
    
    // Activate selected tab
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
    }
    
    setActiveTab(tabId);
    const pdfData = state.openPDFs.get(tabId);
    
    // Emit event
    stateEmitter.emit(StateEvents.TAB_SWITCHED, { tabId, pdfData });
    
    if (pdfData) {
        // Restore this PDF's zoom level
        state.zoomLevel = pdfData.zoomLevel;
        
        // Restore sidebar states for this PDF
        restoreSidebarStates(pdfData);
        
        // Make sure expand buttons are visible
        const expandLeft = document.getElementById('expandLeft');
        const expandRight = document.getElementById('expandRight');
        if (expandLeft) expandLeft.style.display = '';
        if (expandRight) expandRight.style.display = '';
        
        // Update UI with this PDF's data immediately
        updateUIForPDF(pdfData);
        
        // CRITICAL: Always reload PDF in backend when switching tabs
        // The backend can only have ONE PDF open at a time. Even if we have
        // cached HTML/pages, the backend needs to be reloaded for signing,
        // rendering new pages, or any other backend operations.
        // Do this asynchronously in background to not block UI restoration.
        reloadPDFInBackendAsync(pdfData);
        
        // Check if we have saved HTML state (fastest)
        if (pdfData.viewerHTML) {
            // Instant restore from saved HTML
            const viewer = document.getElementById('pdfViewer');
            const pageList = document.getElementById('pageList');
            viewer.innerHTML = pdfData.viewerHTML;
            pageList.innerHTML = pdfData.pageListHTML;
            
            // Restore scroll position
            if (pdfData.scrollPosition !== undefined) {
                viewer.scrollTop = pdfData.scrollPosition;
            }
            
            // Re-attach event listeners
            viewer.removeEventListener('scroll', updateCurrentPageFromScroll);
            viewer.addEventListener('scroll', updateCurrentPageFromScroll);
            viewer.removeEventListener('scroll', lazyLoadVisiblePages);
            viewer.addEventListener('scroll', lazyLoadVisiblePages);
            
            updateStatus(`Viewing: ${pdfData.fileName}`);

            // Load any missing pages in background
            if (pdfData.renderedPages.size < pdfData.totalPages) {
                loadVisiblePages();
            }
        }
        // Check if we have cached pages (build HTML)
        else if (pdfData.renderedPages.size > 0) {
            // Use cached pages - render immediately (FAST)
            renderCachedPDF(pdfData);
        } else {
            // No cache at all, need to load from backend (synchronously)
            await reloadPDFInBackend(pdfData);
        }
    }
    } catch (error) {
        console.error('Error switching tabs:', error);
        updateStatus(`Error switching to tab: ${sanitizeError(error)}`);
        switchToHome();
    } finally {
        tabSwitchInProgress = false;
        
        if (pendingTabSwitch !== null) {
            const nextTabId = pendingTabSwitch;
            pendingTabSwitch = null;
            console.log(`Processing queued tab switch to ${nextTabId}`);
            setTimeout(() => switchToTab(nextTabId), 0);
        }
    }
}

function restoreSidebarStates(pdfData) {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const expandLeft = document.getElementById('expandLeft');
    const expandRight = document.getElementById('expandRight');
    
    // Make sidebars visible first
    if (leftSidebar) leftSidebar.style.display = '';
    if (rightSidebar) rightSidebar.style.display = '';
    
    // Restore left sidebar
    if (leftSidebar) {
        if (pdfData.leftSidebarCollapsed) {
            leftSidebar.classList.add('collapsed');
            if (expandLeft) {
                expandLeft.classList.remove('hidden');
                expandLeft.style.display = '';
            }
        } else {
            leftSidebar.classList.remove('collapsed');
            if (expandLeft) expandLeft.classList.add('hidden');
        }
    }
    
    // Restore right sidebar
    if (rightSidebar) {
        if (pdfData.rightSidebarCollapsed) {
            rightSidebar.classList.add('collapsed');
            if (expandRight) {
                expandRight.classList.remove('hidden');
                expandRight.style.display = '';
            }
        } else {
            rightSidebar.classList.remove('collapsed');
            if (expandRight) expandRight.classList.add('hidden');
        }
    }
}

/** Closes a PDF tab and cleans up resources. */
export function closePDFTab(tabId) {
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
        tab.remove();
    }
    
    const pdfData = state.openPDFs.get(tabId);
    if (pdfData) {
        cleanupScrollListeners(tabId);
        cancelBackgroundLoading(tabId);
        
        // Clear all rendered page data to free memory
        pdfData.renderedPages.clear();
        // Clear HTML cache
        pdfData.viewerHTML = null;
        pdfData.pageListHTML = null;
        
        // Emit event before removal
        stateEmitter.emit(StateEvents.PDF_CLOSED, { tabId, filePath: pdfData.filePath });
    }
    
    // Remove from open PDFs
    removeOpenPDF(tabId);
    
    // If this was the active tab, switch to another or show home
    if (state.activeTabId === tabId) {
        if (state.openPDFs.size > 0) {
            // Switch to first available tab
            const firstTabId = state.openPDFs.keys().next().value;
            switchToTab(firstTabId);
        } else {
            // No PDF tabs left, switch to home
            switchToHome();
        }
    }
}

export function switchToHome() {
    // Deactivate all PDF tabs
    document.querySelectorAll('.pdf-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    if (state.activeTabId) {
        cleanupScrollListeners(state.activeTabId);
        cancelBackgroundLoading(state.activeTabId);
    }
    
    // Activate home tab
    const homeTab = document.getElementById('homeTab');
    if (homeTab) {
        homeTab.classList.add('active');
    }
    
    setActiveTab(null);
    showWelcomeScreen();
    
    // Disable PDF-specific buttons
    const signBtn = document.getElementById('signBtn');
    if (signBtn) signBtn.disabled = true;
    
    // Hide sidebars on home screen
    hideSidebars();
}

export async function showWelcomeScreen() {
    const viewer = document.getElementById('pdfViewer');
    viewer.innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-content">
                <h2>Welcome to PDF App</h2>
                <p>A modern, high-performance PDF editor for Linux</p>
                
                <div class="recent-files-welcome" id="recentFilesWelcome">
                    <h3>Recent Files</h3>
                    <div class="recent-files-grid" id="recentFilesGrid">
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Reset status bar
    updatePageIndicator(null, null);
    updateScrollProgress(null);
    
    // Re-attach welcome button handler
    const welcomeOpenBtn = document.getElementById('welcomeOpenBtn');
    if (welcomeOpenBtn) {
        const { openPDFFile } = await import('./pdfOperations.js');
        welcomeOpenBtn.addEventListener('click', openPDFFile);
    }
    
    // Reload recent files
    const { loadRecentFilesWelcome } = await import('./recentFiles.js');
    loadRecentFilesWelcome();
    
    // Clear page list
    const pageList = document.getElementById('pageList');
    pageList.innerHTML = '<div class="empty-state"><p>No PDF loaded</p></div>';
    
    // Reset properties
    document.getElementById('fileName').textContent = '-';
    document.getElementById('pageCount').textContent = '-';
    
    // Reset signature info
    const signatureInfo = document.getElementById('signatureInfo');
    if (signatureInfo) {
        signatureInfo.innerHTML = '<div class="empty-state"><p>No signature information</p></div>';
    }
}
