import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFService, RecentFilesService } from '../src/js/backend.js';
import { UI } from '../src/js/constants.js';

const renderPageCanvas = vi.fn(async () => document.createElement('canvas'));
vi.mock('../src/js/viewer.js', () => ({
  loadDocument: () => ({ promise: Promise.resolve({ getPage: async () => ({}) }), destroy: async () => {} }),
  renderPageCanvas: (...a) => renderPageCanvas(...a)
}));
vi.mock('../src/js/documents.js', () => ({ openPDFFile: vi.fn(), openRecentFile: vi.fn(), switchToHome: vi.fn() }));
vi.mock('../src/js/settings.js', () => ({ getSetting: () => 5 }));

const { loadRecentFilesWelcome } = await import('../src/js/recentFiles.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="recentFilesGrid"></div>';
  renderPageCanvas.mockClear();
  RecentFilesService.GetRecent.mockResolvedValue([
    { filePath: '/home/u/Documents/a.pdf', fileName: 'a.pdf', lastOpened: '2026-11-12T16:40:00Z', pageCount: 3 }
  ]);
  PDFService.OpenPDFByPath.mockResolvedValue({ id: 'a-1' });
});

describe('recent file thumbnails', () => {
  it('draws the first page several times larger than shown, so its text reads as text, not hairlines', async () => {
    await loadRecentFilesWelcome();
    expect(renderPageCanvas).toHaveBeenCalledTimes(1);
    expect(renderPageCanvas.mock.calls[0][1]).toBeGreaterThanOrEqual(UI.THUMBNAIL_WIDTH * 3);
    expect(document.querySelector('.file-thumbnail-container canvas.file-thumbnail')).not.toBeNull();
  });

  it('shows the page large enough to read as a page: 48px wide', () => {
    expect(UI.THUMBNAIL_WIDTH).toBe(48);
  });
});

describe('recent file names', () => {
  it('keep a quote in a file name inside the remove button\'s label', async () => {
    const fileName = 'a" onmouseover="alert(1).pdf';
    RecentFilesService.GetRecent.mockResolvedValue([{ filePath: `/tmp/${fileName}`, fileName, lastOpened: '2026-11-12T16:40:00Z' }]);
    await loadRecentFilesWelcome();
    const remove = document.querySelector('.recent-file-remove');
    expect(remove.hasAttribute('onmouseover')).toBe(false);
    expect(remove.getAttribute('aria-label')).toBe(`Remove ${fileName} from recent files`);
  });
});
