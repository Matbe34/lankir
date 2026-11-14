import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/js/backend.js';
import { Events } from '@wailsio/runtime';

const openMock = vi.fn();
const showToastMock = vi.fn();
const showOpenErrorMock = vi.fn(() => Promise.resolve());

vi.mock('../src/js/documents.js', () => ({
  openFilePath: openMock,
}));
vi.mock('../src/js/toast.js', () => ({
  showToast: showToastMock,
}));
vi.mock('../src/js/errorRecovery.js', () => ({
  showOpenError: showOpenErrorMock,
}));

beforeEach(() => {
  openMock.mockReset();
  showToastMock.mockReset();
  showOpenErrorMock.mockClear();
  App.TakeStartupFiles.mockReset();
  Events.On.mockReset();
});

describe('handleOpenFiles', () => {
  it('opens a single PDF as a tab', async () => {
    openMock.mockResolvedValue(1);

    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles(['/x/foo.pdf']);

    expect(openMock).toHaveBeenCalledWith('/x/foo.pdf');
  });

  it('shows a toast and opens nothing when the batch is empty', async () => {
    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles([]);

    expect(openMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(expect.stringMatching(/only pdf/i));
  });

  it('reports a file that fails to open and continues', async () => {
    const boom = new Error('boom');
    openMock.mockRejectedValueOnce(boom).mockResolvedValueOnce(2);

    const { handleOpenFiles } = await import('../src/js/fileOpener.js');
    await handleOpenFiles(['/x/a.pdf', '/x/b.pdf']);

    expect(openMock).toHaveBeenCalledTimes(2);
    expect(openMock).toHaveBeenLastCalledWith('/x/b.pdf');
    expect(showOpenErrorMock).toHaveBeenCalledWith(boom, { path: '/x/a.pdf' });
  });
});

describe('initFileOpening', () => {
  it('registers the open-files listener before taking the startup files', async () => {
    const order = [];
    Events.On.mockImplementation(() => order.push('listen'));
    App.TakeStartupFiles.mockImplementation(() => {
      order.push('take');
      return Promise.resolve([]);
    });

    const { initFileOpening } = await import('../src/js/fileOpener.js');
    await initFileOpening();

    expect(order).toEqual(['listen', 'take']);
    expect(Events.On).toHaveBeenCalledWith('open-files', expect.any(Function));
  });

  it('opens the startup files', async () => {
    App.TakeStartupFiles.mockResolvedValue(['/x/start.pdf']);
    openMock.mockResolvedValue(1);

    const { initFileOpening } = await import('../src/js/fileOpener.js');
    await initFileOpening();

    expect(openMock).toHaveBeenCalledWith('/x/start.pdf');
  });

  it('does not toast when there are no startup files', async () => {
    App.TakeStartupFiles.mockResolvedValue([]);

    const { initFileOpening } = await import('../src/js/fileOpener.js');
    await initFileOpening();

    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('opens the paths carried by an open-files event', async () => {
    App.TakeStartupFiles.mockResolvedValue([]);
    openMock.mockResolvedValue(1);

    const { initFileOpening } = await import('../src/js/fileOpener.js');
    await initFileOpening();
    const listener = Events.On.mock.calls[0][1];
    await listener({ name: 'open-files', data: ['/x/dropped.pdf'] });

    expect(openMock).toHaveBeenCalledWith('/x/dropped.pdf');
  });
});
