import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from '../src/js/state.js';

vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { DISABLE: -1, NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15 },
  AnnotationEditorParamsType: { CREATE: 2, HIGHLIGHT_COLOR: 31 },
  HIGHLIGHT_COLORS: { yellow: '#FFFF98', green: '#53FFBC' }
}));

const { initAnnotationToolbar, attachAnnotationToolbar, syncAnnotationToolbar, runEditingAction, handleEditCommand } =
  await import('../src/js/annotationToolbar.js');

function fakeTab(id) {
  const handlers = {};
  return {
    id,
    handlers,
    pdfDocument: {},
    view: {
      eventBus: { dispatch: vi.fn(), on: (name, fn) => { handlers[name] = fn; } },
      pdfViewer: { pdfDocument: {}, annotationEditorMode: 0 }
    }
  };
}

let tab;
const btn = (tool) => document.querySelector(`[data-tool="${tool}"]`);

beforeEach(() => {
  document.body.innerHTML = `
    <button class="tool-btn" data-tool="none"></button>
    <button class="tool-btn" data-tool="highlight"></button>
    <div id="highlightColor"></div>
    <button class="tool-btn" data-tool="freetext"></button>
    <button class="tool-btn" data-tool="ink"></button>
    <button class="tool-btn" data-tool="stamp"></button>
    <input type="file" id="imagePicker" hidden>
    <button id="undoBtn"></button><button id="redoBtn"></button><button id="deleteAnnotationBtn"></button>`;
  initAnnotationToolbar();
  state.openPDFs.clear();
  tab = fakeTab(1);
  state.openPDFs.set(1, tab);
  state.activeTabId = 1;
  attachAnnotationToolbar(tab);
  syncAnnotationToolbar(tab);
});

describe('annotation toolbar', () => {
  it('offers a swatch per highlight colour', () => {
    const swatches = [...document.querySelectorAll('#highlightColor [data-color]')].map((s) => s.dataset.color);
    expect(swatches).toEqual(['#FFFF98', '#53FFBC']);
  });

  it('switches the active viewer to the chosen editor', () => {
    btn('freetext').click();
    expect(tab.view.pdfViewer.annotationEditorMode).toEqual({ mode: 3 });
  });

  it('applies the chosen highlight colour', () => {
    const green = document.querySelector('#highlightColor [data-color="#53FFBC"]');
    green.click();
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('switchannotationeditorparams', { source: null, type: 31, value: '#53FFBC' });
    expect(green.getAttribute('aria-checked')).toBe('true');
  });

  it('picks the image with an attached file input and stamps it', () => {
    const picker = document.getElementById('imagePicker');
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {});
    btn('stamp').click();
    expect(click).toHaveBeenCalled();
    expect(tab.view.pdfViewer.annotationEditorMode).toBe(0);

    const file = new File(['png'], 'turtle.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change'));
    expect(tab.view.pdfViewer.annotationEditorMode).toEqual({ mode: 13 });

    tab.view.pdfViewer.annotationEditorMode = 13;
    tab.handlers.annotationeditormodechanged({ mode: 13 });
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('switchannotationeditorparams', { source: null, type: 2, value: { bitmapFile: file } });
  });

  it('stamps straight away when already in image mode', () => {
    tab.view.pdfViewer.annotationEditorMode = 13;
    const picker = document.getElementById('imagePicker');
    const file = new File(['png'], 'wave.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change'));
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('switchannotationeditorparams', { source: null, type: 2, value: { bitmapFile: file } });
  });

  it('marks the tool pdf.js reports as active', () => {
    tab.view.pdfViewer.annotationEditorMode = 15; // what the real getter returns once the mode switched
    tab.handlers.annotationeditormodechanged({ mode: 15 });
    expect(btn('ink').classList.contains('active')).toBe(true);
    expect(btn('none').classList.contains('active')).toBe(false);
  });

  it('enables undo, redo and delete from the editing state', () => {
    expect(document.getElementById('undoBtn').disabled).toBe(true);
    tab.handlers.editingstateschanged({ details: { hasSomethingToUndo: true, hasSomethingToRedo: false, hasSelectedEditor: true } });
    expect(document.getElementById('undoBtn').disabled).toBe(false);
    expect(document.getElementById('redoBtn').disabled).toBe(true);
    expect(document.getElementById('deleteAnnotationBtn').disabled).toBe(false);
  });

  it('routes Ctrl+Z from Go to pdf.js outside text fields', () => {
    handleEditCommand('undo');
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('editingaction', { source: null, name: 'undo' });
  });

  it('leaves Ctrl+Z in a text field to the field itself', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    document.execCommand = vi.fn();
    handleEditCommand('redo');
    expect(document.execCommand).toHaveBeenCalledWith('redo');
    expect(tab.view.eventBus.dispatch).not.toHaveBeenCalledWith('editingaction', expect.anything());
  });

  it('still undoes in a dialog text field but never edits the page under a dialog', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    document.execCommand = vi.fn();
    handleEditCommand('undo', { dialogOpen: true });
    expect(document.execCommand).toHaveBeenCalledWith('undo');

    input.blur();
    handleEditCommand('undo', { dialogOpen: true });
    expect(tab.view.eventBus.dispatch).not.toHaveBeenCalledWith('editingaction', expect.anything());
  });

  it('runs undo through the pdf.js editor manager', () => {
    document.getElementById('undoBtn').disabled = false;
    document.getElementById('undoBtn').click();
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('editingaction', { source: null, name: 'undo' });
    runEditingAction('redo');
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('editingaction', { source: null, name: 'redo' });
  });
});
