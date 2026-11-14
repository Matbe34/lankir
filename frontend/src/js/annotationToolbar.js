import { state, getActivePDF } from './state.js';
import { AnnotationEditorType, AnnotationEditorParamsType, HIGHLIGHT_COLORS } from './viewer.js';
import { updatePageRoom } from './pageRoom.js';

const TOOLS = {
    none: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    freetext: AnnotationEditorType.FREETEXT,
    ink: AnnotationEditorType.INK,
    stamp: AnnotationEditorType.STAMP
};

const $ = (id) => document.getElementById(id);
let highlightColor = Object.values(HIGHLIGHT_COLORS)[0];
let markupShown = false;
const activeViewer = () => {
    const viewer = getActivePDF()?.view?.pdfViewer;
    return viewer?.pdfDocument ? viewer : null;
};

function dispatchParam(tab, type, value) {
    tab.view.eventBus.dispatch('switchannotationeditorparams', { source: null, type, value });
}

/** Undo, redo, delete or selectAll through the active tab's pdf.js editor manager. */
export function runEditingAction(name) {
    getActivePDF()?.view?.eventBus.dispatch('editingaction', { source: null, name });
}

/**
 * Ctrl+Z / Ctrl+Shift+Z arrive from Go as "edit-command": on Linux Wails
 * consumes them before the webview sees a keydown. Text fields keep their own
 * undo, also in dialogs; elsewhere it goes to pdf.js unless a dialog is open.
 */
export function handleEditCommand(name, { dialogOpen = false } = {}) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        document.execCommand(name);
        return;
    }
    if (!dialogOpen) runEditingAction(name);
}

function selectTool(tool) {
    const tab = getActivePDF();
    const viewer = activeViewer();
    if (!viewer) return;
    if (tool === 'stamp') {
        // pdf.js' own picker is a detached <input type=file>, and WebKitGTK
        // never fires "change" on it, so the image is picked here instead.
        $('imagePicker').click();
        return;
    }
    viewer.annotationEditorMode = { mode: TOOLS[tool] };
}

function stampImage(file) {
    const tab = getActivePDF();
    const viewer = activeViewer();
    if (!viewer || !file) return;
    if (viewer.annotationEditorMode === AnnotationEditorType.STAMP) {
        dispatchParam(tab, AnnotationEditorParamsType.CREATE, { bitmapFile: file });
        return;
    }
    tab.pendingStampFile = file;
    viewer.annotationEditorMode = { mode: AnnotationEditorType.STAMP };
}

/** Shows or hides the markup tools; hiding them goes back to selecting text. */
export function setMarkupShown(shown) {
    markupShown = shown;
    $('viewerToolbar')?.classList.toggle('hidden', !shown);
    $('markupBtn')?.setAttribute('aria-pressed', String(shown));
    updatePageRoom();
    const viewer = activeViewer();
    if (!shown && viewer && viewer.annotationEditorMode > AnnotationEditorType.NONE) {
        viewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
    }
}

function chooseHighlightColor(hex) {
    highlightColor = hex;
    for (const swatch of $('highlightColor').querySelectorAll('[data-color]')) {
        swatch.setAttribute('aria-checked', String(swatch.dataset.color === hex));
    }
    const tab = getActivePDF();
    if (tab?.view) dispatchParam(tab, AnnotationEditorParamsType.HIGHLIGHT_COLOR, hex);
}

/** Binds the toolbar controls; call once at startup. */
export function initAnnotationToolbar() {
    $('markupBtn')?.addEventListener('click', () => setMarkupShown(!markupShown));
    setMarkupShown(false);
    for (const btn of document.querySelectorAll('[data-tool]')) {
        btn.addEventListener('click', () => selectTool(btn.dataset.tool));
    }
    const picker = $('imagePicker');
    picker.addEventListener('change', () => {
        stampImage(picker.files?.[0]);
        picker.value = '';
    });
    const swatches = $('highlightColor');
    for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
        const label = name[0].toUpperCase() + name.slice(1);
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch';
        swatch.dataset.color = hex;
        swatch.dataset.tip = label;
        swatch.setAttribute('role', 'radio');
        swatch.setAttribute('aria-label', label);
        swatch.setAttribute('aria-checked', String(hex === highlightColor));
        swatch.style.setProperty('--swatch', hex);
        swatch.addEventListener('click', () => chooseHighlightColor(hex));
        swatches.append(swatch);
    }
    $('undoBtn').addEventListener('click', () => runEditingAction('undo'));
    $('redoBtn').addEventListener('click', () => runEditingAction('redo'));
    $('deleteAnnotationBtn').addEventListener('click', () => runEditingAction('delete'));
}

/** Follows a tab's editor mode and undo state while it is active. */
export function attachAnnotationToolbar(tab) {
    tab.editingState = {};
    // The editor manager (and so the tools) only exists once the first page is in.
    tab.view.eventBus.on('annotationeditoruimanager', () => {
        if (state.activeTabId === tab.id) syncAnnotationToolbar(tab);
    });
    tab.view.eventBus.on('annotationeditormodechanged', ({ mode }) => {
        if (mode === AnnotationEditorType.STAMP && tab.pendingStampFile) {
            dispatchParam(tab, AnnotationEditorParamsType.CREATE, { bitmapFile: tab.pendingStampFile });
            tab.pendingStampFile = null;
        }
        if (mode === AnnotationEditorType.HIGHLIGHT) {
            dispatchParam(tab, AnnotationEditorParamsType.HIGHLIGHT_COLOR, highlightColor);
        }
        if (state.activeTabId === tab.id) syncAnnotationToolbar(tab);
    });
    tab.view.eventBus.on('editingstateschanged', ({ details }) => {
        Object.assign(tab.editingState, details);
        if (state.activeTabId === tab.id) syncAnnotationToolbar(tab);
    });
}

/** Shows a tab's current tool and undo/redo availability. */
export function syncAnnotationToolbar(tab) {
    const viewer = tab?.view?.pdfViewer;
    const mode = viewer?.pdfDocument ? viewer.annotationEditorMode : AnnotationEditorType.DISABLE;
    const loaded = mode !== AnnotationEditorType.DISABLE;
    for (const btn of document.querySelectorAll('[data-tool]')) {
        btn.disabled = !loaded;
        const active = TOOLS[btn.dataset.tool] === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    }
    const editing = tab?.editingState ?? {};
    $('undoBtn').disabled = !editing.hasSomethingToUndo;
    $('redoBtn').disabled = !editing.hasSomethingToRedo;
    $('deleteAnnotationBtn').disabled = !editing.hasSelectedEditor;
}
