// Application State Management

export const state = {
    openPDFs: new Map(),
    activeTabId: null,
    nextTabId: 1,
    zoomLevel: 1.0,
    viewMode: 'scroll', // 'single' or 'scroll'
    loadingPages: new Set(),
    selectedCertificate: null,
    selectedProfile: null,
    availableProfiles: null,
    signaturePosition: null,
    pdfPath: null
};

export function getActivePDF() {
    return state.activeTabId ? state.openPDFs.get(state.activeTabId) : null;
}

export function createPDFData(tabId, filePath, metadata) {
    return {
        id: tabId,
        filePath: filePath,
        fileName: filePath.split('/').pop(),
        metadata: metadata,
        currentPage: 0,
        totalPages: metadata.pageCount,
        renderedPages: new Map(),
        viewerHTML: null,
        pageListHTML: null,
        scrollPosition: 0,
        zoomLevel: getDefaultZoomLevel(),
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: true
    };
}

export function getNextTabId() {
    return state.nextTabId++;
}

export function getDefaultZoomLevel() {
    try {
        const settings = JSON.parse(localStorage.getItem('pdfEditorSettings') || '{}');
        return (settings.defaultZoom || 100) / 100;
    } catch {
        return 1.0;
    }
}

export function addOpenPDF(tabId, pdfData) {
    state.openPDFs.set(tabId, pdfData);
    // Set global zoom to this PDF's zoom
    state.zoomLevel = pdfData.zoomLevel;
}

export function removeOpenPDF(tabId) {
    state.openPDFs.delete(tabId);
}

export function setActiveTab(tabId) {
    state.activeTabId = tabId;
}

export function setZoomLevel(level) {
    state.zoomLevel = Math.max(0.5, Math.min(3.0, level));
    return state.zoomLevel;
}

export function changeZoom(delta) {
    return setZoomLevel(state.zoomLevel + delta);
}
