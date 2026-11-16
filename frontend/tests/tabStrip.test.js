import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tabLabel, setTabName, headCut, initTabStrip, refreshTabStrip } = await import('../src/js/tabStrip.js');

const $ = (sel) => document.querySelector(sel);

describe('tab label', () => {
  it('drops the .pdf extension and keeps the rest of the name', () => {
    expect(tabLabel('Invoice 2026-0412.pdf')).toBe('Invoice 2026-0412');
    expect(tabLabel('Scan.PDF')).toBe('Scan');
    expect(tabLabel('notes.v2.pdf')).toBe('notes.v2');
  });

  it('keeps names that are only an extension or have another one', () => {
    expect(tabLabel('.pdf')).toBe('.pdf');
    expect(tabLabel('README')).toBe('README');
    expect(tabLabel('report.pdf.txt')).toBe('report.pdf.txt');
  });

  it('shows the label cut in the middle, keeping its last word whole, and remembers the whole name', () => {
    const span = document.createElement('span');
    setTabName(span, 'Lease agreement - Carrer Major 14.pdf');
    expect(span.textContent).toBe('Lease agreement - Carrer Major 14');
    expect(span.classList.contains('truncate-middle')).toBe(true);
    expect(span.querySelector('.truncate-head').textContent).toBe('Lease agreement - Carrer ');
    expect(span.querySelector('.truncate-tail').textContent).toBe('Major 14');
    expect(span.dataset.name).toBe('Lease agreement - Carrer Major 14.pdf');
  });

  it('keeps separators in the head and cuts a long last word to its end', () => {
    const tail = (name) => {
      const span = document.createElement('span');
      setTabName(span, name);
      return span.querySelector('.truncate-tail').textContent;
    };
    expect(tail('Meeting notes - kickoff.pdf')).toBe('kickoff');
    expect(tail('Invoice 2026-0412.pdf')).toBe('2026-0412');
    expect(tail('Scan_20261113_contract_final.pdf')).toBe('act_final');
    expect(tail('Notes.pdf')).toBe('Notes');
  });

  // The browser's ellipsis leaves the rest of the head's box empty: a hole
  // before the tail. A cut head instead ends after its last whole letter,
  // and the tail ("…" first) closes up to it.
  describe('a cut head', () => {
    const mono = (n) => n * 7; // every letter 7px wide

    it('ends after the last letter that fits, the ellipsis flush against the tail', () => {
      expect(headCut('Master Services ', mono, 60)).toEqual({ end: 8, shown: 56 }); // "Master S"
    });

    it('never leaves a space or separator before the ellipsis', () => {
      expect(headCut('Meeting notes - ', mono, 60)).toEqual({ end: 7, shown: 49 }); // "Meeting", not "Meeting "
      expect(headCut('Lease agreement - Carrer ', mono, 125)).toEqual({ end: 15, shown: 105 }); // "Lease agreement", not "… - "
    });

    it('is null when the whole head fits', () => {
      expect(headCut('Master Services ', mono, 112)).toBeNull();
    });
  });
});

// The strip is 500px wide and every shown tab 150px.
function layout(count, { active = 0 } = {}) {
  const strip = $('#pdfTabsContainer');
  Object.defineProperty(strip, 'clientWidth', { value: 500, configurable: true });
  Object.defineProperty(strip, 'scrollWidth', {
    get: () => [...strip.children].filter((tab) => !tab.hidden).length * 150, configurable: true
  });
  for (let i = 0; i < count; i++) {
    const tab = document.createElement('div');
    tab.className = 'pdf-tab' + (i === active ? ' active' : '');
    tab.dataset.tabId = String(i + 1);
    tab.innerHTML = '<span class="pdf-tab-name"></span>';
    setTabName(tab.firstChild, `Document ${i + 1}.pdf`);
    strip.append(tab);
  }
}

const shownTabs = () => [...document.querySelectorAll('.pdf-tab')].filter((t) => !t.hidden).map((t) => Number(t.dataset.tabId));

describe('tab overflow', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pdfTabsContainer"></div>
      <button id="tabOverflowBtn" class="hidden"><span id="tabOverflowCount"></span></button>
      <div id="tabOverflowMenu" class="menu hidden"></div>`;
    onSelect.mockReset();
    initTabStrip({ onSelect });
  });

  it('stops following the names of closed tabs and of a refilled menu', () => {
    const unobserve = vi.spyOn(ResizeObserver.prototype, 'unobserve');
    layout(3);
    refreshTabStrip();
    const closed = document.querySelector('.pdf-tab .pdf-tab-name');
    closed.closest('.pdf-tab').remove();
    refreshTabStrip();
    expect(unobserve).toHaveBeenCalledWith(closed);
    expect(unobserve).toHaveBeenCalledTimes(1);

    $('#tabOverflowBtn').click();
    const label = $('#tabOverflowMenu .menu-label');
    $('#tabOverflowBtn').click();
    $('#tabOverflowBtn').click();
    expect(unobserve).toHaveBeenCalledWith(label);
    unobserve.mockRestore();
  });

  it('stays hidden while every tab fits', () => {
    layout(3);
    refreshTabStrip();
    expect($('#tabOverflowBtn').classList.contains('hidden')).toBe(true);
    expect(shownTabs()).toEqual([1, 2, 3]);
  });

  it('moves the tabs that do not fit into "N more", from the end', () => {
    layout(6);
    refreshTabStrip();
    expect(shownTabs()).toEqual([1, 2, 3]);
    expect($('#tabOverflowBtn').classList.contains('hidden')).toBe(false);
    expect($('#tabOverflowCount').textContent).toBe('3 more tabs');
  });

  it('always shows the active tab', () => {
    layout(6, { active: 5 });
    refreshTabStrip();
    expect(shownTabs()).toEqual([4, 5, 6]);
    expect($('#tabOverflowCount').textContent).toBe('3 more tabs');
  });

  it('shows hidden tabs again when there is room', () => {
    layout(6);
    refreshTabStrip();
    for (const tab of [...document.querySelectorAll('.pdf-tab')].slice(0, 2)) tab.remove();
    refreshTabStrip();
    expect(shownTabs()).toEqual([3, 4, 5]);
    expect($('#tabOverflowCount').textContent).toBe('1 more tab');
    for (const tab of [...document.querySelectorAll('.pdf-tab')].slice(0, 2)) tab.remove();
    refreshTabStrip();
    expect(shownTabs()).toEqual([5, 6]);
    expect($('#tabOverflowBtn').classList.contains('hidden')).toBe(true);
  });

  // Tabs as wide as their names (at most `natural`), sharing the 500px strip when it is full.
  function contentSized(naturals) {
    const strip = $('#pdfTabsContainer');
    const shown = () => [...strip.children].filter((tab) => !tab.hidden);
    naturals.forEach((natural, i) => {
      const tab = document.createElement('div');
      tab.className = 'pdf-tab' + (i === 0 ? ' active' : '');
      tab.dataset.tabId = String(i + 1);
      tab.innerHTML = '<span class="pdf-tab-name"></span>';
      setTabName(tab.firstChild, `Document ${i + 1}.pdf`);
      const width = () => (tab.hidden ? 0 : Math.min(natural, 500 / shown().length));
      Object.defineProperty(tab, 'offsetWidth', { get: width });
      // Only the head of a middle-cut name shrinks.
      const head = tab.querySelector('.truncate-head');
      Object.defineProperty(head, 'clientWidth', { get: () => Math.max(0, width() - 24) });
      Object.defineProperty(head, 'scrollWidth', { get: () => natural - 24 });
      strip.append(tab);
    });
    Object.defineProperty(strip, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(strip, 'scrollWidth', { get: () => shown().reduce((sum, tab) => sum + tab.offsetWidth, 0), configurable: true });
  }

  it('moves tabs into "N more" before their names would be cut below 140px', () => {
    contentSized([200, 200, 200, 200]);
    refreshTabStrip();
    expect(shownTabs()).toEqual([1, 2, 3]);
    expect($('#tabOverflowCount').textContent).toBe('1 more tab');
    // Full: the shown tabs share the strip equally, up to "N more tabs".
    expect($('#pdfTabsContainer').classList.contains('is-full')).toBe(true);
  });

  it('keeps short names that fit whole, however narrow', () => {
    contentSized([90, 90, 90, 90, 90]);
    refreshTabStrip();
    expect(shownTabs()).toEqual([1, 2, 3, 4, 5]);
    expect($('#tabOverflowBtn').classList.contains('hidden')).toBe(true);
    expect($('#pdfTabsContainer').classList.contains('is-full')).toBe(false);
  });

  it('lists every tab, marks the active one and switches to the one picked', () => {
    layout(6, { active: 1 });
    refreshTabStrip();
    $('#tabOverflowBtn').click();
    const items = [...document.querySelectorAll('#tabOverflowMenu [role="menuitemradio"]')];
    expect(items.map((i) => i.textContent.trim())).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Document ${n}`));
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
    items[4].click();
    expect(onSelect).toHaveBeenCalledWith(5);
  });
});
