/** Global application state for open tabs. */
export const state = {
    openPDFs: new Map(),
    activeTabId: null,
    nextTabId: 1
};

/** Returns the currently active tab, or null if none. */
export function getActivePDF() {
    return state.activeTabId ? state.openPDFs.get(state.activeTabId) : null;
}

/**
 * Creates the state of one tab. docId is the Go registry id that serves the
 * file at /doc/<docId>; the pdf.js objects are filled in once it loads.
 */
export function createPDFData(tabId, filePath, docId) {
    return {
        id: tabId,
        docId,
        filePath,
        fileName: filePath.split(/[/\\]/).pop(),
        currentPage: 1,
        totalPages: 0,
        dirty: false,
        // Go's working-copy state: unsaved page operations, how many undo can
        // take back and how many undone ones redo can bring back.
        modified: false,
        undoSteps: 0,
        redoSteps: 0,
        // undefined: keep the file's protection; a string: protect with it ('' removes it) at save.
        protect: undefined,
        password: null,
        selection: new Set(),
        loadSeq: 0,
        loadingTask: null,
        pdfDocument: null,
        view: null, // { container, eventBus, linkService, findController, pdfViewer }
        panelOpen: false, // the side panel, as this tab last had it
        panelTab: 'pages' // its segment: 'pages', 'index' or 'signatures'
    };
}

/** Generates the next unique tab ID. */
export function getNextTabId() {
    return state.nextTabId++;
}

/** Adds a tab to the open documents map. */
export function addOpenPDF(tabId, pdfData) {
    state.openPDFs.set(tabId, pdfData);
}

/** Removes a tab from the open documents map. */
export function removeOpenPDF(tabId) {
    state.openPDFs.delete(tabId);
}

/** Sets the active tab. */
export function setActiveTab(tabId) {
    state.activeTabId = tabId;
}
