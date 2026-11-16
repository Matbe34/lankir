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
vi.mock('../src/js/state.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getActivePDF: () => ({ id: 1, filePath: '/docs/a.pdf' })
}));
const organize = {
  initOrganize: vi.fn(),
  toggleOrganize: vi.fn(),
  leaveOrganize: vi.fn(),
  handleOrganizeKey: vi.fn(() => false),
  handlePageUndo: vi.fn(() => true),
  escapeOrganize: vi.fn(() => true),
  stepThumbSize: vi.fn(() => false),
  syncOrganize: vi.fn(),
  disposeOrganize: vi.fn()
};
vi.mock('../src/js/organize.js', () => organize);
const zoom = { zoomIn: vi.fn(), zoomOut: vi.fn() };
vi.mock('../src/js/navigation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  zoomIn: (...a) => zoom.zoomIn(...a),
  zoomOut: (...a) => zoom.zoomOut(...a)
}));
const handleEditCommand = vi.fn();
vi.mock('../src/js/annotationToolbar.js', async (importOriginal) => ({
  ...(await importOriginal()),
  handleEditCommand: (...a) => handleEditCommand(...a)
}));

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>'))
  .replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

let onEdit; // Go's edit-command handler, kept from the first test (mocks are cleared after it)

it('Ctrl Shift O organizes, Escape ends it, and Ctrl Z from Go goes to page changes first', async () => {
  document.body.innerHTML = body;
  ConfigService.Get.mockResolvedValue({});
  await import('../src/js/app.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(Events.On).toHaveBeenCalledWith('edit-command', expect.any(Function)));
  expect(organize.initOrganize).toHaveBeenCalled();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  expect(organize.toggleOrganize).toHaveBeenCalledTimes(1);

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(organize.escapeOrganize).toHaveBeenCalledTimes(1);

  onEdit = Events.On.mock.calls.find(([name]) => name === 'edit-command')[1];
  onEdit({ data: 'undo' });
  expect(organize.handlePageUndo).toHaveBeenCalledWith('undo');
  expect(handleEditCommand).not.toHaveBeenCalled();

  // A text field keeps its own undo.
  organize.handlePageUndo.mockClear();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  onEdit({ data: 'undo' });
  expect(organize.handlePageUndo).not.toHaveBeenCalled();
  expect(handleEditCommand).toHaveBeenCalledWith('undo', { dialogOpen: false });
});

it('Ctrl Z from Go after the thumbnail slider or a checkbox is still a page change', async () => {
  for (const type of ['range', 'checkbox']) {
    organize.handlePageUndo.mockClear();
    handleEditCommand.mockClear();
    const input = Object.assign(document.createElement('input'), { type });
    document.body.append(input);
    input.focus();
    onEdit({ data: 'undo' });
    expect(organize.handlePageUndo, type).toHaveBeenCalledWith('undo');
    expect(handleEditCommand, type).not.toHaveBeenCalled();
  }
});

it('Escape with the focus outside a document dialog closes the dialog, not organizing', async () => {
  const { openDialog } = await import('../src/js/documentDialog.js');
  document.body.innerHTML = body;
  organize.escapeOrganize.mockClear();
  const dialog = openDialog({ id: 'splitDialog', title: 'Split', actions: [{ label: 'Cancel', value: null }] });
  document.body.focus();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.getElementById('splitDialog')).toBeNull();
  await expect(dialog.done).resolves.toBeNull();
  expect(organize.escapeOrganize).not.toHaveBeenCalled();
});

it('Ctrl Plus and Ctrl Minus size the thumbnails while organizing, and zoom the page when reading', () => {
  const press = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
  zoom.zoomIn.mockClear();
  zoom.zoomOut.mockClear();
  organize.stepThumbSize.mockReturnValue(true);
  press('+');
  press('-');
  expect(organize.stepThumbSize.mock.calls).toEqual([[1], [-1]]);
  expect(zoom.zoomIn).not.toHaveBeenCalled();
  expect(zoom.zoomOut).not.toHaveBeenCalled();

  organize.stepThumbSize.mockReturnValue(false);
  press('=');
  press('-');
  expect(zoom.zoomIn).toHaveBeenCalledTimes(1);
  expect(zoom.zoomOut).toHaveBeenCalledTimes(1);
});

it('Ctrl Plus and Ctrl Minus still size the thumbnails after the size slider was used', () => {
  document.body.innerHTML = body;
  organize.stepThumbSize.mockClear();
  organize.stepThumbSize.mockReturnValue(true);
  document.getElementById('organizeSize').focus();
  for (const k of ['+', '-']) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
  expect(organize.stepThumbSize.mock.calls).toEqual([[1], [-1]]);
});
