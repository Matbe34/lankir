import { describe, it, expect, vi, beforeEach } from 'vitest';

const openMock = vi.fn();
const createTabMock = vi.fn();
const switchTabMock = vi.fn();
const showMessageMock = vi.fn();

vi.mock('../src/js/pdfManager.js', () => ({
  createPDFTab: createTabMock,
  switchToTab: switchTabMock,
}));
vi.mock('../src/js/messageDialog.js', () => ({
  showMessage: showMessageMock,
}));

beforeEach(() => {
  openMock.mockReset();
  createTabMock.mockReset();
  switchTabMock.mockReset();
  showMessageMock.mockReset();
  globalThis.window = globalThis.window || {};
  window.go = { pdf: { PDFService: { OpenPDFByPath: openMock } } };
});

describe('handleOpenFiles', () => {
  it('opens a single PDF as a new tab and switches to it', async () => {
    openMock.mockResolvedValue({ filePath: '/x/foo.pdf', pageCount: 1 });
    createTabMock.mockReturnValue('tab-1');

    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles(['/x/foo.pdf']);

    expect(openMock).toHaveBeenCalledWith('/x/foo.pdf');
    expect(createTabMock).toHaveBeenCalledWith('/x/foo.pdf', expect.any(Object));
    expect(switchTabMock).toHaveBeenCalledWith('tab-1');
  });

  it('shows a toast and skips backend calls when batch is empty', async () => {
    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles([]);

    expect(openMock).not.toHaveBeenCalled();
    expect(createTabMock).not.toHaveBeenCalled();
    expect(showMessageMock).toHaveBeenCalledWith(
      expect.stringMatching(/no pdf/i),
      expect.any(String),
      'info'
    );
  });

  it('shows a per-file toast on backend error and continues', async () => {
    openMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ filePath: '/x/b.pdf' });
    createTabMock.mockReturnValue('tab-b');

    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles(['/x/a.pdf', '/x/b.pdf']);

    expect(openMock).toHaveBeenCalledTimes(2);
    expect(showMessageMock).toHaveBeenCalledWith(expect.stringMatching(/a\.pdf/), expect.any(String), 'error');
    expect(createTabMock).toHaveBeenCalledTimes(1);
    expect(createTabMock).toHaveBeenCalledWith('/x/b.pdf', expect.any(Object));
  });
});
