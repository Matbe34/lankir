import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/js/pageRoom.js', () => ({ updatePageRoom: vi.fn() }));
vi.mock('../src/js/sidebar.js', () => ({ sharpenThumbnails: vi.fn() }));

const { updatePageRoom } = await import('../src/js/pageRoom.js');
const { sharpenThumbnails } = await import('../src/js/sidebar.js');
const {
  PANEL_WIDTH, panelRange, clampPanelWidth, stepPanelWidth, thumbColumns, thumbRenderWidth,
  loadPanelWidth, savePanelWidth, initPanelResize
} = await import('../src/js/panelResize.js');

const KEY = 'lankir.sidePanelWidth';
const setWindowWidth = (width) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
};
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe('panel width range', () => {
  it('runs from one thumbnail column to 560px, or 45% of a smaller window', () => {
    expect(PANEL_WIDTH).toEqual({ min: 180, default: 272, max: 560 });
    expect(panelRange(1440)).toEqual({ min: 180, max: 560 });
    expect(panelRange(1024)).toEqual({ min: 180, max: 460 });
    // Never a max below the min.
    expect(panelRange(300)).toEqual({ min: 180, max: 180 });
  });

  it('clamps a width into the range for the window', () => {
    expect(clampPanelWidth(100, 1440)).toBe(180);
    expect(clampPanelWidth(900, 1440)).toBe(560);
    expect(clampPanelWidth(500, 1024)).toBe(460);
    expect(clampPanelWidth(300.6, 1440)).toBe(301);
    expect(clampPanelWidth(NaN, 1440)).toBe(272);
  });

  it('steps 16px with the arrows, 64px with Shift, and jumps to the ends with Home and End', () => {
    const range = panelRange(1440);
    expect(stepPanelWidth(272, 'ArrowRight', false, range)).toBe(288);
    expect(stepPanelWidth(272, 'ArrowLeft', false, range)).toBe(256);
    expect(stepPanelWidth(272, 'ArrowRight', true, range)).toBe(336);
    expect(stepPanelWidth(272, 'ArrowLeft', true, range)).toBe(208);
    expect(stepPanelWidth(190, 'ArrowLeft', true, range)).toBe(180);
    expect(stepPanelWidth(550, 'ArrowRight', false, range)).toBe(560);
    expect(stepPanelWidth(272, 'Home', false, range)).toBe(180);
    expect(stepPanelWidth(272, 'End', false, range)).toBe(560);
    expect(stepPanelWidth(272, 'Enter', false, range)).toBeNull();
  });
});

describe('thumbnail columns', () => {
  it('fits one column at the narrowest, two by default and three or four when wide', () => {
    expect(thumbColumns(180)).toBe(1);
    expect(thumbColumns(243)).toBe(1);
    expect(thumbColumns(244)).toBe(2);
    expect(thumbColumns(272)).toBe(2);
    expect(thumbColumns(360)).toBe(3);
    expect(thumbColumns(460)).toBe(3);
    expect(thumbColumns(560)).toBe(4);
  });

  it('draws thumbnails at least 180px wide, and wider for a wider column', () => {
    expect(thumbRenderWidth(272)).toBe(180);
    expect(thumbRenderWidth(560)).toBe(180);
    // One column 219px wide.
    expect(thumbRenderWidth(243)).toBe(220);
  });
});

describe('remembered width', () => {
  beforeEach(() => localStorage.clear());

  it('saves and reads back the width', () => {
    savePanelWidth(380);
    expect(localStorage.getItem(KEY)).toBe('380');
    expect(loadPanelWidth()).toBe(380);
  });

  it('ignores a missing or broken value', () => {
    expect(loadPanelWidth()).toBeNull();
    localStorage.setItem(KEY, 'wide');
    expect(loadPanelWidth()).toBeNull();
  });

  it('survives storage that throws', () => {
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadPanelWidth()).toBeNull();
    expect(() => savePanelWidth(300)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('resize handle', () => {
  let workspace;
  let handle;
  const width = () => workspace.style.getPropertyValue('--panel-w');

  beforeEach(() => {
    localStorage.clear();
    setWindowWidth(1440);
    document.body.innerHTML = `
      <main id="workspace">
        <aside id="sidePanel"></aside>
        <div id="panelResizer" tabindex="0"></div>
      </main>`;
    workspace = document.getElementById('workspace');
    handle = document.getElementById('panelResizer');
  });

  it('starts at the default width and describes itself as a separator', () => {
    initPanelResize();
    expect(width()).toBe('272px');
    expect(workspace.style.getPropertyValue('--thumb-cols')).toBe('2');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe('Resize side panel');
    expect(handle.getAttribute('aria-valuemin')).toBe('180');
    expect(handle.getAttribute('aria-valuemax')).toBe('560');
    expect(handle.getAttribute('aria-valuenow')).toBe('272');
  });

  it('restores the remembered width on launch', () => {
    localStorage.setItem(KEY, '420');
    initPanelResize();
    expect(width()).toBe('420px');
    expect(workspace.style.getPropertyValue('--thumb-cols')).toBe('3');
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
  });

  it('steps with the keyboard, moves the page and remembers the width', () => {
    initPanelResize();
    updatePageRoom.mockClear();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(width()).toBe('288px');
    expect(handle.getAttribute('aria-valuenow')).toBe('288');
    expect(updatePageRoom).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('288');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    expect(width()).toBe('224px');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(width()).toBe('560px');
    expect(workspace.style.getPropertyValue('--thumb-cols')).toBe('4');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(width()).toBe('180px');
    expect(workspace.style.getPropertyValue('--thumb-cols')).toBe('1');
  });

  it('keeps its keys from also turning the page', () => {
    initPanelResize();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    document.removeEventListener('keydown', pageKeys);
    expect(pageKeys).toHaveBeenCalledTimes(1);
  });

  it('resets to the default width on double-click', () => {
    localStorage.setItem(KEY, '480');
    initPanelResize();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(width()).toBe('272px');
    expect(localStorage.getItem(KEY)).toBe('272');
  });

  it('follows a drag a frame at a time and remembers where it ends', async () => {
    initPanelResize();
    updatePageRoom.mockClear();
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 284, pointerId: 1, button: 0, bubbles: true }));
    expect(document.documentElement.classList.contains('panel-resizing')).toBe(true);
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 330, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 384, pointerId: 1, bubbles: true }));
    expect(width()).toBe('272px'); // not before the next frame
    await frame();
    expect(width()).toBe('372px');
    expect(updatePageRoom).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeNull(); // not while dragging
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 2000, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 2000, pointerId: 1, bubbles: true }));
    expect(width()).toBe('560px');
    expect(localStorage.getItem(KEY)).toBe('560');
    expect(document.documentElement.classList.contains('panel-resizing')).toBe(false);
  });

  it('sharpens the thumbnails once a resize settles', async () => {
    vi.useFakeTimers();
    try {
      initPanelResize();
      sharpenThumbnails.mockClear();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(sharpenThumbnails).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(sharpenThumbnails).toHaveBeenCalledTimes(1);
      expect(sharpenThumbnails).toHaveBeenCalledWith(thumbRenderWidth(212));
    } finally {
      vi.useRealTimers();
    }
  });

  it('narrows to fit a smaller window and widens back when it grows', () => {
    localStorage.setItem(KEY, '540');
    initPanelResize();
    updatePageRoom.mockClear();
    setWindowWidth(1024);
    window.dispatchEvent(new Event('resize'));
    expect(width()).toBe('460px');
    expect(handle.getAttribute('aria-valuemax')).toBe('460');
    expect(updatePageRoom).toHaveBeenCalled();
    setWindowWidth(1440);
    window.dispatchEvent(new Event('resize'));
    expect(width()).toBe('540px');
    expect(localStorage.getItem(KEY)).toBe('540');
  });
});
