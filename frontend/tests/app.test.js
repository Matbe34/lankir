import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { Events } from '@wailsio/runtime';
import { ConfigService } from '../src/js/backend.js';

vi.mock('../src/js/viewer.js', () => ({
  AnnotationEditorType: { NONE: 0 },
  AnnotationEditorParamsType: {},
  PasswordResponses: {},
  HIGHLIGHT_COLORS: {},
  loadDocument: vi.fn(),
  createViewer: vi.fn(),
  renderPageCanvas: vi.fn()
}));

const printTab = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../src/js/print.js', () => ({ printTab }));

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

let booted = null;
/** Starts the app once; later tests reuse it with a fresh page body. */
function boot() {
  booted ??= (async () => {
    ConfigService.Get.mockResolvedValue({});
    await import('../src/js/app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.waitFor(() => expect(Events.On).toHaveBeenCalledWith('close-requested', expect.any(Function)));
  })();
  return booted;
}

it('Escape on a confirm shown over the sign panel dismisses only the confirm', async () => {
  document.body.innerHTML = body;
  await boot();
  const { showConfirm } = await import('../src/js/messageDialog.js');

  const signPanel = document.getElementById('signPanel');
  signPanel.classList.remove('hidden');
  const answer = showConfirm('"/out/copy.pdf" already exists. Replace it?', 'Replace file');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  expect(await answer).toBe(false);
  expect(signPanel.classList.contains('hidden')).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(signPanel.classList.contains('hidden')).toBe(true);
});

it('ignores app shortcuts while the sign panel is open', async () => {
  document.body.innerHTML = body;
  await boot();
  const { PDFService } = await import('../src/js/backend.js');
  const ctrlO = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }));
  const signPanel = document.getElementById('signPanel');
  signPanel.classList.remove('hidden');
  ctrlO();
  expect(PDFService.OpenPDF).not.toHaveBeenCalled();

  signPanel.classList.add('hidden');
  ctrlO();
  expect(PDFService.OpenPDF).toHaveBeenCalled();
});

it('Ctrl K opens the command palette, Escape closes it', async () => {
  document.body.innerHTML = body;
  await boot();
  const palette = () => document.getElementById('commandPalette');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  expect(palette().classList.contains('hidden')).toBe(false);
  expect(document.activeElement).toBe(document.getElementById('paletteInput'));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(palette().classList.contains('hidden')).toBe(true);
});

// pdf.js' editor manager listens for copy/cut/paste on the whole document and calls
// preventDefault, which swallowed pastes into the find box and other text fields.
it('keeps copy, cut and paste working in text fields while pdf.js editing is active', async () => {
  const pdfjsHandler = (e) => e.preventDefault();
  for (const type of ['copy', 'cut', 'paste']) document.addEventListener(type, pdfjsHandler);
  try {
    const input = document.body.appendChild(document.createElement('input'));
    for (const type of ['copy', 'cut', 'paste']) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      input.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(false);
    }
    // Outside text fields pdf.js still gets the event (e.g. pasting an image onto the page).
    const e = new Event('paste', { bubbles: true, cancelable: true });
    document.body.appendChild(document.createElement('div')).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  } finally {
    for (const type of ['copy', 'cut', 'paste']) document.removeEventListener(type, pdfjsHandler);
  }
});

it('lets text selection start on saved text-markup annotations', () => {
  const css = fs.readFileSync(new URL('src/styles/viewer.css', `file://${process.cwd()}/`), 'utf8');
  expect(css).toMatch(/\.annotationLayer\s+:is\(\.highlightAnnotation,\s*\.underlineAnnotation,\s*\.squigglyAnnotation,\s*\.strikeoutAnnotation\)\s*\{\s*pointer-events:\s*none/);
});

it('Escape closes the command palette before the panel behind it, even with focus out of its field', async () => {
  document.body.innerHTML = body;
  await boot();
  const { openCommandPalette, isCommandPaletteOpen } = await import('../src/js/commandPalette.js');
  const { RecentFilesService } = await import('../src/js/backend.js');
  RecentFilesService.GetRecent.mockResolvedValue([]);
  const signPanel = document.getElementById('signPanel');
  signPanel.classList.remove('hidden');
  openCommandPalette();
  document.getElementById('paletteInput').blur();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(isCommandPaletteOpen()).toBe(false);
  expect(signPanel.classList.contains('hidden')).toBe(false);
});

it('Ctrl P prints the active document, and follows the shortcut setting', async () => {
  document.body.innerHTML = body;
  await boot();
  const { state } = await import('../src/js/state.js');
  const { setSetting } = await import('../src/js/settings.js');
  const tab = { id: 7, fileName: 'a.pdf', pdfDocument: { numPages: 0 } };
  state.openPDFs.set(tab.id, tab);
  state.activeTabId = tab.id;
  const press = (init) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(e);
    return e;
  };
  try {
    expect(press({ key: 'p', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(printTab).toHaveBeenCalledWith(tab);

    printTab.mockClear();
    setSetting('shortcuts', { print: 'Control+Shift+p' });
    press({ key: 'p', ctrlKey: true });
    expect(printTab).not.toHaveBeenCalled();
    press({ key: 'P', ctrlKey: true, shiftKey: true });
    expect(printTab).toHaveBeenCalledWith(tab);
  } finally {
    setSetting('shortcuts', {});
    state.openPDFs.delete(tab.id);
    state.activeTabId = null;
  }
});
