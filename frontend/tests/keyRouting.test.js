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
vi.mock('../src/js/navigation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  handleNavigationKey: vi.fn(() => true)
}));
vi.mock('../src/js/state.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getActivePDF: () => ({ id: 1, filePath: '/docs/a.pdf' })
}));

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>'))
  .replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

it('arrow keys that switch side panel segments do not also turn the page', async () => {
  document.body.innerHTML = body;
  ConfigService.Get.mockResolvedValue({});
  await import('../src/js/app.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(Events.On).toHaveBeenCalledWith('close-requested', expect.any(Function)));
  const { handleNavigationKey } = await import('../src/js/navigation.js');

  const pages = document.querySelector('.tab-btn[data-tab="pages"]');
  pages.focus();
  pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(handleNavigationKey).not.toHaveBeenCalled();

  // The same key elsewhere still turns the page.
  document.body.focus();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(handleNavigationKey).toHaveBeenCalledTimes(1);
});
