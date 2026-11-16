import { describe, it, expect, beforeEach } from 'vitest';
import { state, createPDFData } from '../src/js/state.js';

const { pageRoom, updatePageRoom } = await import('../src/js/pageRoom.js');
const { showToast } = await import('../src/js/toast.js');

// Widths are the page as drawn (pdf.js' 9px transparent border left out);
// left is where the side panel ends, right how far the sign panel reaches in
// from the view's right edge.
describe('pageRoom', () => {
  it('needs nothing when nothing floats beside the page', () => {
    expect(pageRoom({ viewWidth: 900, pageWidth: 900, left: 0, right: 0 })).toBeNull();
  });

  it('leaves a page alone that is already 16px clear of the panels', () => {
    // 1440: the side panel, the sign panel, or both, beside a page at 100%.
    expect(pageRoom({ viewWidth: 1440, pageWidth: 793, left: 284, right: 0 })).toBeNull();
    expect(pageRoom({ viewWidth: 1440, pageWidth: 793, left: 0, right: 308 })).toBeNull();
    expect(pageRoom({ viewWidth: 1440, pageWidth: 793, left: 284, right: 308 })).toBeNull();
  });

  it('moves a page only as far as it must to stay 16px clear of a panel', () => {
    expect(pageRoom({ viewWidth: 1280, pageWidth: 793, left: 284, right: 0 })).toEqual({ left: 113, right: 0, shift: 56.5, scale: 1 });
    expect(pageRoom({ viewWidth: 1024, pageWidth: 600, left: 0, right: 308 })).toEqual({ left: 0, right: 224, shift: -112, scale: 1 });
  });

  it('fits a page that is wider than the room the panels leave, with 24px either side', () => {
    expect(pageRoom({ viewWidth: 1024, pageWidth: 793, left: 284, right: 0 }).scale).toBe(692 / 793);
    expect(pageRoom({ viewWidth: 1024, pageWidth: 793, left: 0, right: 308 }).scale).toBe(668 / 793);
    // Fitted, it fills that room.
    expect(pageRoom({ viewWidth: 1024, pageWidth: 692, left: 284, right: 0, gutter: 24 })).toEqual({ left: 284, right: 0, shift: 142, scale: 1 });
    expect(pageRoom({ viewWidth: 1024, pageWidth: 668, left: 0, right: 308, gutter: 24 })).toEqual({ left: 0, right: 308, shift: -154, scale: 1 });
  });

  it('starts a page that stays wider than the room right of the side panel', () => {
    expect(pageRoom({ viewWidth: 1024, pageWidth: 1200, left: 284, right: 0, border: 9 })).toMatchObject({ left: 299, right: 0 });
  });
});

describe('updatePageRoom', () => {
  let container;
  let viewer;
  let tab;
  let page;

  const place = (el, left, top, width, height) => {
    for (const [key, value] of Object.entries({ offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height })) {
      Object.defineProperty(el, key, { value, configurable: true });
    }
  };

  // A workspace below the header, with a page 793px wide (as drawn) at 100%.
  function setUp(width) {
    document.body.innerHTML = `
      <main id="workspace">
        <div id="pdfViewer"><div class="pdf-view"><div class="pdfViewer"><div class="page" data-page-number="1"></div></div></div></div>
        <aside id="sidePanel" class="hidden"></aside>
        <div id="viewerToolbar" class="hidden"></div>
        <div id="findBar" class="hidden"></div>
        <aside id="signPanel" class="hidden"></aside>
      </main>`;
    container = document.querySelector('.pdf-view');
    place(container, 0, 0, width, 656);
    Object.defineProperty(container, 'clientWidth', { value: width });
    // pdf.js' zoom: a number, or a value such as "1" or "page-width".
    viewer = {
      pdfDocument: {},
      scale: 1,
      value: '1',
      get currentScale() { return this.scale; },
      set currentScale(scale) { this.scale = scale; this.value = String(scale); },
      get currentScaleValue() { return this.value; },
      set currentScaleValue(value) { this.value = value; this.scale = Number(value); }
    };
    // The page's width follows the zoom, as pdf.js lays it out, inside a 9px border.
    page = container.querySelector('.page');
    Object.defineProperty(page, 'clientWidth', { get: () => Math.round(793 * viewer.currentScale) });
    Object.defineProperty(page, 'offsetWidth', { get: () => Math.round(793 * viewer.currentScale) + 18 });
    place(document.getElementById('sidePanel'), 12, 12, 272, 578);
    place(document.getElementById('viewerToolbar'), 317, 12, 390, 36);
    place(document.getElementById('findBar'), width - 316, 12, 300, 76);
    place(document.getElementById('signPanel'), width - 308, 12, 296, 500);
    state.openPDFs.clear();
    tab = Object.assign(createPDFData(1, '/docs/a.pdf', 'a'), { view: { container, pdfViewer: viewer } });
    state.openPDFs.set(1, tab);
    state.activeTabId = 1;
  }

  beforeEach(() => setUp(1024));

  const prop = (el, name) => el.style.getPropertyValue(name);
  const show = (id, shown = true) => document.getElementById(id).classList.toggle('hidden', !shown);

  it('fits the page beside an open side panel and moves it there', () => {
    show('sidePanel');
    updatePageRoom();
    expect(viewer.currentScale).toBeCloseTo(692 / 793);
    updatePageRoom(); // after the zoom, as the scale event does
    expect(container.classList.contains('page-room')).toBe(true);
    expect(prop(container, '--room-left')).toBe('284px');
    expect(prop(container, '--room-right')).toBe('0px');
    expect(viewer.currentScale).toBeCloseTo(692 / 793);
  });

  it('places the toasts again for where the page pill goes', () => {
    document.getElementById('workspace').insertAdjacentHTML('beforeend', '<div id="pagePill" class="page-pill"></div>');
    document.body.insertAdjacentHTML('beforeend', '<div id="toastRegion"></div>');
    const region = document.getElementById('toastRegion');
    showToast('Saved');
    expect(region.classList.contains('is-lifted')).toBe(false);
    const pill = document.getElementById('pagePill');
    pill.getClientRects = () => [{}];
    pill.getBoundingClientRect = () => ({ left: 400, right: 800, top: 700, bottom: 740, width: 400, height: 40 });
    region.getBoundingClientRect = () => ({ left: 648, right: 1008, top: 700, bottom: 740, width: 360, height: 40 });
    show('sidePanel');
    updatePageRoom();
    expect(region.classList.contains('is-lifted')).toBe(true);
  });

  it('centres the page pill under the page', () => {
    show('sidePanel');
    updatePageRoom();
    expect(prop(document.getElementById('workspace'), '--page-shift')).toBe('142px');
  });

  it('leaves a page at 1440 where it is when the side panel opens beside it', () => {
    setUp(1440);
    const panel = document.getElementById('sidePanel');
    panel.getBoundingClientRect = () => ({ left: 12, top: 56, right: 284, bottom: 634, width: 272, height: 578 });
    show('sidePanel');
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
    expect(container.classList.contains('page-room')).toBe(false);
    expect(prop(document.getElementById('workspace'), '--page-shift')).toBe('0px');
  });

  it('moves the page aside as the side panel widens, and back as it narrows', () => {
    setUp(1440);
    show('sidePanel');
    updatePageRoom();
    expect(container.classList.contains('page-room')).toBe(false);
    // 500px wide: the page moves right until it is 16px clear, at the same zoom.
    place(document.getElementById('sidePanel'), 12, 12, 500, 578);
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
    expect(prop(container, '--room-left')).toBe('409px');
    expect(prop(document.getElementById('workspace'), '--page-shift')).toBe('205px');
    place(document.getElementById('sidePanel'), 12, 12, 272, 578);
    updatePageRoom();
    expect(container.classList.contains('page-room')).toBe(false);
    expect(prop(document.getElementById('workspace'), '--page-shift')).toBe('0px');
  });

  it('fits the page again each time the side panel changes width', () => {
    show('sidePanel');
    updatePageRoom();
    expect(viewer.currentScale).toBeCloseTo(692 / 793);
    place(document.getElementById('sidePanel'), 12, 12, 400, 578);
    updatePageRoom();
    // 1024 - 412 - 24 * 2 = 564, from the zoom the user had.
    expect(viewer.currentScale).toBeCloseTo(564 / 793);
    show('sidePanel', false);
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
  });

  it('leaves a page at 1440 where it is when the sign panel opens beside it', () => {
    setUp(1440);
    show('signPanel');
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
    expect(container.classList.contains('page-room')).toBe(false);
  });

  it('gives the zoom back when the panel closes', () => {
    show('sidePanel');
    updatePageRoom();
    show('sidePanel', false);
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
    expect(container.classList.contains('page-room')).toBe(false);
    expect(prop(container, '--room-left')).toBe('0px');
    expect(prop(document.getElementById('workspace'), '--page-shift')).toBe('0px');
  });

  it('keeps a zoom the user chose while the panel was open', () => {
    show('sidePanel');
    updatePageRoom();
    viewer.currentScaleValue = '1.5';
    updatePageRoom();
    expect(viewer.currentScale).toBe(1.5);
    show('sidePanel', false);
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1.5');
  });

  it('keeps a zoom that already fits', () => {
    viewer.currentScaleValue = '0.75';
    show('sidePanel');
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('0.75');
    expect(container.classList.contains('page-room')).toBe(true);
  });

  it('fits the page beside the sign panel and puts find left of it', () => {
    show('signPanel');
    show('findBar');
    updatePageRoom();
    expect(viewer.currentScale).toBeCloseTo(668 / 793);
    expect(prop(document.getElementById('workspace'), '--free-right')).toBe('320px');
  });

  it('keeps find hits below the find box and the markup tools', () => {
    show('viewerToolbar');
    updatePageRoom();
    expect(prop(container, '--room-top')).toBe('60px');
    show('findBar');
    updatePageRoom();
    expect(prop(container, '--room-top')).toBe('100px');
  });

  it('leaves the page alone for the find box alone', () => {
    show('findBar');
    updatePageRoom();
    expect(viewer.currentScaleValue).toBe('1');
    expect(container.classList.contains('page-room')).toBe(false);
  });
});
