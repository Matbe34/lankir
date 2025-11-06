// UI Setup and Interactions

import { state, setActiveTab } from './state.js';
import { switchToHome } from './pdfManager.js';

export function setupEventListeners() {
    const openBtn = document.getElementById('openBtn');
    const signBtn = document.getElementById('signBtn');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomInput = document.getElementById('zoomInput');
    const collapseLeft = document.getElementById('collapseLeft');
    const expandLeft = document.getElementById('expandLeft');
    const collapseRight = document.getElementById('collapseRight');
    const expandRight = document.getElementById('expandRight');
    
    // Certificate dialog buttons
    const certDialogClose = document.getElementById('certDialogClose');
    const certDialogRefresh = document.getElementById('certDialogRefresh');
    const certDialogCancel = document.getElementById('certDialogCancel');
    const certDialogSign = document.getElementById('certDialogSign');
    
    // Use dynamic imports to avoid circular dependencies
    if (openBtn) {
        openBtn.addEventListener('click', async () => {
            const { openPDFFile } = await import('./pdfOperations.js');
            openPDFFile();
        });
    }
    
    if (signBtn) {
        signBtn.addEventListener('click', async () => {
            const { signPDF } = await import('./signature.js');
            signPDF();
        });
    }
    
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', async () => {
            const { changeZoom } = await import('./zoom.js');
            changeZoom(0.1);
        });
    }
    
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', async () => {
            const { changeZoom } = await import('./zoom.js');
            changeZoom(-0.1);
        });
    }
    
    if (zoomInput) {
        zoomInput.addEventListener('change', async () => {
            const { setZoomFromInput } = await import('./zoom.js');
            setZoomFromInput(zoomInput.value);
        });
        
        zoomInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const { setZoomFromInput } = await import('./zoom.js');
                setZoomFromInput(zoomInput.value);
                zoomInput.blur(); // Remove focus after setting
            }
        });
        
        // Allow selecting all text on focus
        zoomInput.addEventListener('focus', () => {
            zoomInput.select();
        });
    }
    
    if (collapseLeft) collapseLeft.addEventListener('click', () => toggleSidebar('left', false));
    if (expandLeft) expandLeft.addEventListener('click', () => toggleSidebar('left', true));
    if (collapseRight) collapseRight.addEventListener('click', () => toggleSidebar('right', false));
    if (expandRight) expandRight.addEventListener('click', () => toggleSidebar('right', true));
    
    // Certificate dialog event listeners
    if (certDialogClose) {
        certDialogClose.addEventListener('click', async () => {
            const { closeCertificateDialog } = await import('./signature.js');
            closeCertificateDialog();
        });
    }
    
    if (certDialogRefresh) {
        certDialogRefresh.addEventListener('click', async () => {
            const { showCertificateDialog } = await import('./signature.js');
            const { getActivePDF } = await import('./state.js');
            
            const activePDF = getActivePDF();
            if (activePDF) {
                await showCertificateDialog(activePDF.filePath);
            }
        });
    }
    
    if (certDialogCancel) {
        certDialogCancel.addEventListener('click', async () => {
            const { closeCertificateDialog } = await import('./signature.js');
            closeCertificateDialog();
        });
    }
    
    if (certDialogSign) {
        certDialogSign.addEventListener('click', async () => {
            const { performSigning } = await import('./signature.js');
            performSigning();
        });
    }
    
    // Close dialog on overlay click
    const certDialog = document.getElementById('certDialog');
    if (certDialog) {
        certDialog.addEventListener('click', async (e) => {
            if (e.target === certDialog) {
                const { closeCertificateDialog } = await import('./signature.js');
                closeCertificateDialog();
            }
        });
    }
    
    // Allow Enter key in PIN input to trigger signing
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter' && !certDialogSign.disabled) {
                const { performSigning } = await import('./signature.js');
                performSigning();
            }
        });
    }
}

export function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
}

export function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Update content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const targetTab = document.getElementById(tabName + 'Tab');
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

export function toggleSidebar(side, show) {
    const sidebar = document.getElementById(side === 'left' ? 'leftSidebar' : 'rightSidebar');
    const expandBtn = document.getElementById(side === 'left' ? 'expandLeft' : 'expandRight');
    
    if (show) {
        sidebar.classList.remove('collapsed');
        expandBtn.classList.add('hidden');
    } else {
        sidebar.classList.add('collapsed');
        expandBtn.classList.remove('hidden');
    }
}

export function setupHomeTab() {
    const homeTab = document.getElementById('homeTab');
    if (homeTab) {
        homeTab.addEventListener('click', () => {
            switchToHome();
        });
    }
}

export function hideSidebars() {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const expandLeft = document.getElementById('expandLeft');
    const expandRight = document.getElementById('expandRight');
    
    if (leftSidebar) leftSidebar.style.display = 'none';
    if (rightSidebar) rightSidebar.style.display = 'none';
    if (expandLeft) expandLeft.style.display = 'none';
    if (expandRight) expandRight.style.display = 'none';
}

export function showSidebars() {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    
    if (leftSidebar) leftSidebar.style.display = '';
    if (rightSidebar) rightSidebar.style.display = '';
}

export function initializeUI() {
    setupEventListeners();
    setupTabs();
    setupHomeTab();
    hideSidebars();
}
