import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initialBox, hasSavedPosition, startPlacement } from '../src/js/signaturePlacement.js';

const A4 = [595, 842];
const pageBounds = () => [0, 0, ...A4];
const builtInVisible = { visibility: 'visible', position: { page: 0, x: 360, y: 50, width: 200, height: 80 } };

describe('initialBox', () => {
  it('centres the profile-sized box on the current page without a saved position', () => {
    expect(hasSavedPosition(builtInVisible)).toBe(false);
    expect(initialBox(builtInVisible, { numPages: 3, currentPage: 2, pageBounds }))
      .toEqual({ page: 2, x: (595 - 200) / 2, y: (842 - 80) / 2, width: 200, height: 80 });
  });

  it('uses a saved position, with page 0 meaning the last page', () => {
    const profile = { visibility: 'visible', position: { page: 0, x: 40, y: 30, width: 150, height: 60 } };
    expect(hasSavedPosition(profile)).toBe(true);
    expect(initialBox(profile, { numPages: 3, currentPage: 1, pageBounds }))
      .toEqual({ page: 3, x: 40, y: 30, width: 150, height: 60 });
  });

  it('keeps a saved box inside the page', () => {
    const profile = { visibility: 'visible', position: { page: 9, x: 590, y: 900, width: 200, height: 80 } };
    expect(initialBox(profile, { numPages: 2, currentPage: 1, pageBounds }))
      .toEqual({ page: 2, x: 395, y: 762, width: 200, height: 80 });
  });

  it('respects a page whose box does not start at the origin', () => {
    const cropped = () => [10, 20, 605, 862];
    expect(initialBox(builtInVisible, { numPages: 1, currentPage: 1, pageBounds: cropped }))
      .toEqual({ page: 1, x: 207.5, y: 401, width: 200, height: 80 });
    const saved = { visibility: 'visible', position: { page: 1, x: 0, y: 0, width: 150, height: 60 } };
    expect(initialBox(saved, { numPages: 1, currentPage: 1, pageBounds: cropped }))
      .toEqual({ page: 1, x: 10, y: 20, width: 150, height: 60 });
  });
});

// pdf.js' PageViewport transform (pdfjs-dist 6.5.438 build/pdf.mjs) for a
// page shown with /Rotate rotation.
function pageViewport(viewBox, rotation, scale = 1) {
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotation];
  const ox = (a === 0 ? Math.abs(centerY - viewBox[1]) : Math.abs(centerX - viewBox[0])) * scale;
  const oy = (a === 0 ? Math.abs(centerX - viewBox[0]) : Math.abs(centerY - viewBox[1])) * scale;
  const m = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * centerX - c * scale * centerY, oy - b * scale * centerX - d * scale * centerY];
  return {
    viewBox,
    convertToViewportPoint: (x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]],
    convertToPdfPoint: (x, y) => {
      const det = m[0] * m[3] - m[1] * m[2];
      return [(x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det, (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det];
    }
  };
}

// A fake pdf.js viewer at scale 1: viewport y grows downwards from the page top.
function fakeTab(rotation = 0) {
  const listeners = {};
  const pages = [1, 2].map((n) => {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.pageNumber = String(n);
    div.getBoundingClientRect = () => ({ left: 0, top: 0, right: A4[0], bottom: A4[1] });
    return {
      div,
      pdfPage: { view: [0, 0, ...A4] },
      viewport: pageViewport([0, 0, ...A4], rotation)
    };
  });
  const container = document.createElement('div');
  container.append(...pages.map((p) => p.div));
  document.body.append(container);
  return {
    view: {
      container,
      eventBus: { on: (n, f) => { listeners[n] = f; }, off: vi.fn() },
      pdfViewer: { pagesCount: 2, currentPageNumber: 1, getPageView: (i) => pages[i] }
    },
    pages
  };
}

const pointer = (type, target, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));

// Every placement a test starts, stopped after it so its window listeners go.
const started = [];
const place = (...args) => {
  const placing = startPlacement(...args);
  started.push(placing);
  return placing;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  while (started.length) started.pop().stop();
});

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

describe('startPlacement', () => {
  it('shows the box on the page while placing and gives its position', () => {
    const tab = fakeTab();
    const placing = place(tab, builtInVisible);
    const box = tab.pages[0].div.querySelector('.signature-box');
    expect(box).not.toBeNull();
    expect(tab.view.container.classList.contains('placing-signature')).toBe(true);
    expect(placing.position()).toEqual({ page: 1, x: 197.5, y: 381, width: 200, height: 80 });

    placing.stop();
    expect(box.isConnected).toBe(false);
    expect(tab.view.container.classList.contains('placing-signature')).toBe(false);
  });

  it('draws a new box where the user drags on another page and reports the page', () => {
    const tab = fakeTab();
    const onChange = vi.fn();
    const placing = place(tab, builtInVisible, { onChange });
    expect(onChange).toHaveBeenLastCalledWith(1);
    pointer('pointerdown', tab.pages[1].div, 100, 700);
    pointer('pointermove', window, 300, 760);
    pointer('pointerup', window, 300, 760);
    expect(tab.pages[1].div.querySelector('.signature-box')).not.toBeNull();
    expect(placing.position()).toEqual({ page: 2, x: 100, y: 82, width: 200, height: 60 });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps a box drawn past the page edges or into the gap on the page', () => {
    const tab = fakeTab();
    const placing = place(tab, builtInVisible);
    pointer('pointerdown', tab.pages[0].div, 500, 100);
    pointer('pointermove', window, 700, -50);
    pointer('pointerup', window, 700, -50);
    expect(placing.position()).toEqual({ page: 1, x: 500, y: 742, width: 95, height: 100 });
  });

  it('keeps a moved box on the page', () => {
    const tab = fakeTab();
    const placing = place(tab, builtInVisible);
    const box = tab.pages[0].div.querySelector('.signature-box');
    pointer('pointerdown', box, 297.5, 421);
    pointer('pointermove', window, 2000, 2000);
    pointer('pointerup', window, 2000, 2000);
    expect(placing.position()).toEqual({ page: 1, x: 395, y: 0, width: 200, height: 80 });
  });

  it('stops reacting to the pointer once stopped', () => {
    const tab = fakeTab();
    const placing = place(tab, builtInVisible);
    placing.stop();
    pointer('pointerdown', tab.pages[1].div, 100, 700);
    pointer('pointerup', window, 300, 760);
    expect(tab.pages[1].div.querySelector('.signature-box')).toBeNull();
  });

  it('scrolls the page so the box keeps 32px clear of the panel it must avoid', () => {
    const tab = fakeTab();
    const { container } = tab.view;
    let scrolled = 0;
    Object.defineProperty(container, 'scrollLeft', { get: () => scrolled, set: (v) => { scrolled = v; }, configurable: true });
    // The panel covers x 700..1000; the box sits at x 600..800 until the page scrolls.
    const panel = rect(700, 12, 300, 400);
    const placing = place(tab, builtInVisible, { avoid: () => panel });
    const box = tab.pages[0].div.querySelector('.signature-box');
    box.getBoundingClientRect = () => rect(600 - scrolled, 300, 200, 80);

    placing.reveal();
    expect(container.classList.contains('sign-room')).toBe(true);
    expect(box.getBoundingClientRect().right).toBeLessThanOrEqual(panel.left - 32);
    placing.stop();
    expect(container.classList.contains('sign-room')).toBe(false);
  });

  it('leaves the page alone when the box is clear of the panel', () => {
    const tab = fakeTab();
    const placing = place(tab, builtInVisible, { avoid: () => rect(900, 12, 300, 400) });
    tab.pages[0].div.querySelector('.signature-box').getBoundingClientRect = () => rect(300, 300, 200, 80);
    placing.reveal();
    expect(tab.view.container.classList.contains('sign-room')).toBe(false);
    placing.stop();
  });

  it('shows the stamp the profile draws inside the box, sized to it, and swaps it when told', () => {
    const tab = fakeTab();
    const stamp = { html: '<div class="preview-text"><div class="preview-line">Signed by A</div><div class="preview-line">Date</div></div>', layout: 'icon-left', lines: 2 };
    const placing = place(tab, builtInVisible, { stamp });
    const box = tab.pages[0].div.querySelector('.signature-box');
    const shown = box.querySelector('.signature-stamp');
    expect(shown.textContent).toContain('Signed by A');
    expect(shown.classList.contains('icon-left')).toBe(true);
    // As the stamp is drawn: a 2 pt margin, then the height split over the lines plus one, at 80%.
    expect(parseFloat(shown.style.getPropertyValue('--stamp-pad'))).toBeCloseTo(2);
    expect(parseFloat(shown.style.getPropertyValue('--stamp-font'))).toBeCloseTo((80 - 4) / 3 * 0.8);

    placing.setStamp({ html: '<div class="preview-text"><div class="preview-line">Signed by B</div></div>', layout: 'icon-top', lines: 1 });
    expect(box.querySelector('.signature-stamp').textContent).toBe('Signed by B');
    expect(box.querySelector('.signature-stamp').classList.contains('icon-top')).toBe(true);
    placing.setStamp(null);
    expect(box.querySelector('.signature-stamp').hidden).toBe(true);
  });

  for (const rotation of [0, 90, 180, 270]) {
    it(`resizes from the handle on a page rotated ${rotation}°, keeping the opposite corner`, () => {
      const tab = fakeTab(rotation);
      const placing = place(tab, builtInVisible);
      const box = tab.pages[0].div.querySelector('.signature-box');
      const rect = () => ['left', 'top', 'width', 'height'].map((k) => parseFloat(box.style[k]));
      const [left, top, width, height] = rect();
      const handle = box.querySelector('.signature-box-handle');

      pointer('pointerdown', handle, left + width, top + height);
      pointer('pointermove', window, left + width + 30, top + height + 40);
      pointer('pointerup', window, left + width + 30, top + height + 40);
      const after = rect();
      expect(after[0]).toBeCloseTo(left);
      expect(after[1]).toBeCloseTo(top);
      expect(after[2]).toBeCloseTo(width + 30);
      expect(after[3]).toBeCloseTo(height + 40);

      // Dragged back onto the opposite corner, the box keeps its minimum size.
      pointer('pointerdown', handle, left + width + 30, top + height + 40);
      pointer('pointermove', window, left + 1, top + 1);
      pointer('pointerup', window, left + 1, top + 1);
      expect(rect()[0]).toBeCloseTo(left);
      expect(rect()[1]).toBeCloseTo(top);
      expect(placing.position()).toMatchObject({ width: 20, height: 10 });
    });
  }
});
