/** Global application state for open PDFs and UI configuration. */
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

/** Returns the currently active PDF data, or null if none. */
export function getActivePDF() {
    return state.activeTabId ? state.openPDFs.get(state.activeTabId) : null;
}

/** Creates a new PDF data object for the state map. */
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

/** Generates the next unique tab ID. */
export function getNextTabId() {
    return state.nextTabId++;
}

/** Returns the default zoom level from user settings (default: 1.0). */
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

/** Adds a PDF to the open documents map. */
export function addOpenPDF(tabId, pdfData) {
    state.openPDFs.set(tabId, pdfData);
    state.zoomLevel = pdfData.zoomLevel;
}

/** Removes a PDF from the open documents map and emits PDF_CLOSED event. */
export function removeOpenPDF(tabId) {
    state.openPDFs.delete(tabId);
}

/** Sets the active tab and emits TAB_SWITCHED event. */
export function setActiveTab(tabId) {
    state.activeTabId = tabId;
}

/** Updates the global zoom level, clamped between 0.1 and 3.0. */
export function setZoomLevel(level) {
    state.zoomLevel = Math.max(0.1, Math.min(3.0, level));
    return state.zoomLevel;
}

/** Adjusts zoom by delta and returns the new level. */
export function changeZoom(delta) {
    return setZoomLevel(state.zoomLevel + delta);
}
