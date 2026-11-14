import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/js/viewer.js', () => ({
  renderPageCanvas: vi.fn(async () => document.createElement('canvas'))
}));

globalThis.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; this.observed = []; }
  observe(el) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
};

const { buildOutlineTree, setupSidebar, showSidebarFor, disposeSidebar, sharpenThumbnails } = await import('../src/js/sidebar.js');
const { renderPageCanvas } = await import('../src/js/viewer.js');
const { state } = await import('../src/js/state.js');

const outline = [
  { title: 'Chapter 1', dest: 'c1', items: [{ title: 'Section 1.1', dest: 's11', items: [] }] },
  { title: 'Chapter 2', dest: [{ num: 5 }, { name: 'XYZ' }], items: [], bold: true }
];

beforeEach(() => {
  document.body.innerHTML = `
    <button class="tab-btn" data-tab="pages"></button>
    <button class="tab-btn" data-tab="index"></button>
    <div id="pageList"></div>
    <div id="outlineView"></div>`;
});

describe('buildOutlineTree', () => {
  it('returns null for a document without an outline', () => {
    expect(buildOutlineTree(null, vi.fn())).toBeNull();
    expect(buildOutlineTree([], vi.fn())).toBeNull();
  });

  it('builds a nested list with collapsed children', () => {
    const tree = buildOutlineTree(outline, vi.fn());
    const top = tree.querySelectorAll(':scope > li');
    expect(top).toHaveLength(2);
    expect(top[0].querySelector('.outline-link').textContent).toBe('Chapter 1');
    const children = top[0].querySelector('ul');
    expect(children.hidden).toBe(true);
    expect(children.querySelector('.outline-link').textContent).toBe('Section 1.1');
    expect(top[1].querySelector('ul')).toBeNull();
    expect(top[1].querySelector('.outline-link').style.fontWeight).toBe('bold');
  });

  it('toggles children and reports the clicked item', () => {
    const onSelect = vi.fn();
    const tree = buildOutlineTree(outline, onSelect);
    const first = tree.querySelector('li');
    first.querySelector('.outline-toggle').click();
    expect(first.querySelector('ul').hidden).toBe(false);
    first.querySelector('ul .outline-link').click();
    expect(onSelect).toHaveBeenCalledWith(outline[0].items[0]);
  });
});

function fakeTab(outlineItems) {
  const handlers = {};
  return {
    id: 1,
    totalPages: 3,
    currentPage: 1,
    pdfDocument: { getOutline: vi.fn(async () => outlineItems), getPage: vi.fn(async () => ({})) },
    view: {
      eventBus: { on: (name, fn) => { handlers[name] = fn; } },
      linkService: { goToDestination: vi.fn(), goToPage: vi.fn() },
      pdfViewer: {}
    },
    handlers
  };
}

describe('per-tab sidebar', () => {
  it('lists one thumbnail slot per page and navigates on click', async () => {
    const tab = fakeTab(null);
    setupSidebar(tab);
    showSidebarFor(tab);
    const items = document.querySelectorAll('#pageList .page-item');
    expect(items).toHaveLength(3);
    items[2].click();
    expect(tab.view.linkService.goToPage).toHaveBeenCalledWith(3);
  });

  it('highlights the current page as the viewer scrolls', () => {
    const tab = fakeTab(null);
    setupSidebar(tab);
    showSidebarFor(tab);
    tab.handlers.pagechanging({ pageNumber: 2 });
    const active = document.querySelectorAll('#pageList .page-item.active');
    expect(active).toHaveLength(1);
    expect(active[0].dataset.pageNumber).toBe('2');
  });

  it('hides the Index tab when the document has no outline', async () => {
    const tab = fakeTab([]);
    setupSidebar(tab);
    await tab.sidebar.outlineReady;
    showSidebarFor(tab);
    expect(document.querySelector('[data-tab="index"]').hidden).toBe(true);
  });

  it('shows the outline and goes to its destination', async () => {
    const tab = fakeTab(outline);
    setupSidebar(tab);
    await tab.sidebar.outlineReady;
    showSidebarFor(tab);
    expect(document.querySelector('[data-tab="index"]').hidden).toBe(false);
    document.querySelectorAll('#outlineView > ul > li > .outline-row > .outline-link')[1].click();
    expect(tab.view.linkService.goToDestination).toHaveBeenCalledWith(outline[1].dest);
  });

  it('disconnects the thumbnail observer when the tab is disposed', () => {
    const tab = fakeTab(null);
    setupSidebar(tab);
    const observer = tab.sidebar.observer;
    disposeSidebar(tab);
    expect(observer.disconnected).toBe(true);
    expect(tab.sidebar).toBeNull();
  });

  it('draws each thumbnail to fill its column', async () => {
    const tab = fakeTab(null);
    setupSidebar(tab);
    const item = tab.sidebar.pages.firstChild;
    tab.sidebar.observer.cb([{ isIntersecting: true, target: item }]);
    await vi.waitFor(() => expect(item.querySelector('canvas')).not.toBeNull());
    expect(item.querySelector('canvas').style.width).toBe('100%');
    expect(renderPageCanvas).toHaveBeenLastCalledWith(expect.anything(), 180);
  });

  it('redraws drawn thumbnails sharper once their column grows past them', async () => {
    const tab = fakeTab(null);
    state.openPDFs.set(tab.id, tab);
    setupSidebar(tab);
    const [first, second] = tab.sidebar.pages.children;
    tab.sidebar.observer.cb([{ isIntersecting: true, target: first }]);
    await vi.waitFor(() => expect(first.querySelector('canvas')).not.toBeNull());
    tab.sidebar.observer.observed.length = 0;

    sharpenThumbnails(180);
    expect(tab.sidebar.observer.observed).toEqual([]);

    sharpenThumbnails(220);
    // Only the drawn one; the other is still waiting to be drawn.
    expect(tab.sidebar.observer.observed).toEqual([first]);
    tab.sidebar.observer.cb([{ isIntersecting: true, target: first }, { isIntersecting: true, target: second }]);
    await vi.waitFor(() => expect(second.querySelector('canvas')).not.toBeNull());
    expect(renderPageCanvas.mock.calls.slice(-2).map((call) => call[1])).toEqual([220, 220]);
    state.openPDFs.delete(tab.id);
  });
});
