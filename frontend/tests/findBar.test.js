import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from '../src/js/state.js';
import { initFindBar, openFindBar, closeFindBar, attachFindBar, formatMatchCount } from '../src/js/findBar.js';

function fakeTab(id) {
  const handlers = {};
  return {
    id,
    handlers,
    view: {
      eventBus: {
        dispatch: vi.fn(),
        on: (name, fn) => { handlers[name] = fn; }
      }
    }
  };
}

let tab;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="findBar" class="hidden">
      <input id="findInput">
      <span id="findCount"></span>
      <button id="findPrev"></button>
      <button id="findNext"></button>
      <button id="findMatchCase" aria-pressed="false"></button>
      <button id="findWholeWord" aria-pressed="false"></button>
      <button id="findHighlightAll" aria-pressed="true"></button>
      <button id="findClose"></button>
    </div>`;
  initFindBar();
  state.openPDFs.clear();
  tab = fakeTab(1);
  state.openPDFs.set(1, tab);
  state.activeTabId = 1;
  attachFindBar(tab);
});

const input = () => document.getElementById('findInput');
const lastFind = () => tab.view.eventBus.dispatch.mock.calls.filter(([n]) => n === 'find').at(-1)?.[1];
const key = (k, opts = {}) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));

describe('formatMatchCount', () => {
  it('formats the pdf.js match counts', () => {
    expect(formatMatchCount({ current: 2, total: 7 }, 0)).toBe('2 of 7');
    expect(formatMatchCount({ current: 0, total: 0 }, 1)).toBe('No matches');
    expect(formatMatchCount({ current: 0, total: 0 }, 3)).toBe('');
    expect(formatMatchCount(undefined, 0)).toBe('');
  });
});

describe('find bar', () => {
  it('opens focused and searches as the user types', () => {
    openFindBar();
    expect(document.getElementById('findBar').classList.contains('hidden')).toBe(false);
    expect(document.activeElement).toBe(input());

    input().value = 'fox';
    input().dispatchEvent(new Event('input'));
    expect(lastFind()).toMatchObject({ type: '', query: 'fox', caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
  });

  it('goes to the next match on Enter and the previous on Shift+Enter', () => {
    openFindBar();
    input().value = 'fox';
    key('Enter');
    expect(lastFind()).toMatchObject({ type: 'again', query: 'fox', findPrevious: false });
    key('Enter', { shiftKey: true });
    expect(lastFind()).toMatchObject({ type: 'again', findPrevious: true });
  });

  it('passes the match case and whole word toggles', () => {
    openFindBar();
    input().value = 'Fox';
    const matchCase = document.getElementById('findMatchCase');
    matchCase.click();
    expect(matchCase.getAttribute('aria-pressed')).toBe('true');
    expect(lastFind()).toMatchObject({ type: 'casesensitivitychange', caseSensitive: true });
    document.getElementById('findWholeWord').click();
    expect(lastFind()).toMatchObject({ type: 'entirewordchange', caseSensitive: true, entireWord: true });
  });

  it('turns highlight all off and on again', () => {
    openFindBar();
    input().value = 'Fox';
    const all = document.getElementById('findHighlightAll');
    all.click();
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(lastFind()).toMatchObject({ type: 'highlightallchange', highlightAll: false });
    all.click();
    expect(lastFind()).toMatchObject({ type: 'highlightallchange', highlightAll: true });
  });

  it('shows "N of M" from the active tab', () => {
    openFindBar();
    tab.handlers.updatefindmatchescount({ matchesCount: { current: 3, total: 30 } });
    expect(document.getElementById('findCount').textContent).toBe('3 of 30');
    tab.handlers.updatefindcontrolstate({ state: 1, matchesCount: { current: 0, total: 0 } });
    expect(document.getElementById('findCount').textContent).toBe('No matches');
  });

  it('ignores counts from a tab that is not active', () => {
    const other = fakeTab(2);
    state.openPDFs.set(2, other);
    attachFindBar(other);
    other.handlers.updatefindmatchescount({ matchesCount: { current: 1, total: 1 } });
    expect(document.getElementById('findCount').textContent).toBe('');
  });

  it('closes on Escape and clears the highlights', () => {
    openFindBar();
    key('Escape');
    expect(document.getElementById('findBar').classList.contains('hidden')).toBe(true);
    expect(tab.view.eventBus.dispatch).toHaveBeenCalledWith('findbarclose', { source: null });
  });

  it('closing for an inactive tab leaves the bar alone', () => {
    openFindBar();
    const other = fakeTab(2);
    closeFindBar(other);
    expect(other.view.eventBus.dispatch).toHaveBeenCalledWith('findbarclose', { source: null });
    expect(document.getElementById('findBar').classList.contains('hidden')).toBe(false);
  });
});

describe('going to a match', () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

  // pdf.js' own scrollMatchIntoView: it clears its flag and scrolls the match to the top.
  function viewWithMatchAt(matchRect) {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => rect(0, 44, 1440, 856);
    for (const [side, value] of Object.entries({ top: '102px', right: '0px', bottom: '70px', left: '0px' })) {
      container.style.setProperty(`scroll-padding-${side}`, value);
    }
    document.body.append(container);
    const element = document.createElement('span');
    element.getBoundingClientRect = () => matchRect;
    element.scrollIntoView = vi.fn();
    const findController = {
      _scrollMatches: true,
      scrollMatchIntoView({ element: el }) {
        this._scrollMatches = false;
        el.scrollIntoView({ block: 'start', inline: 'center' });
      }
    };
    const other = fakeTab(3);
    Object.assign(other.view, { container, findController });
    attachFindBar(other);
    return { element, findController };
  }

  it('leaves the page where it is when the match is already in view, clear of the floats', () => {
    const { element, findController } = viewWithMatchAt(rect(593, 204, 57, 16));
    findController.scrollMatchIntoView({ element, pageIndex: 0, matchIndex: 0 });
    expect(element.scrollIntoView).not.toHaveBeenCalled();
    expect(findController._scrollMatches).toBe(false);
  });

  it('scrolls to a match under the find box or the page pill', () => {
    for (const top of [100, 820]) {
      const { element, findController } = viewWithMatchAt(rect(593, top, 57, 16));
      findController.scrollMatchIntoView({ element, pageIndex: 0, matchIndex: 0 });
      expect(element.scrollIntoView).toHaveBeenCalledOnce();
    }
  });
});
