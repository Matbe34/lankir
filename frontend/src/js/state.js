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
        let zoom = (settings.defaultZoom || 100) / 100;
        if (isNaN(zoom) || zoom < 0.1) zoom = 1.0;
        return zoom;
    } catch {
        return 1.0;
    }
}

export function addOpenPDF(tabId, pdfData) {
    state.openPDFs.set(tabId, pdfData);
    state.zoomLevel = pdfData.zoomLevel;
}

export function removeOpenPDF(tabId) {
    state.openPDFs.delete(tabId);
}

export function setActiveTab(tabId) {
    state.activeTabId = tabId;
}

export function setZoomLevel(level) {
    state.zoomLevel = Math.max(0.1, Math.min(3.0, level));
    return state.zoomLevel;
}

export function changeZoom(delta) {
    return setZoomLevel(state.zoomLevel + delta);
}
