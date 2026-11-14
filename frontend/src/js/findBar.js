import { state, getActivePDF } from './state.js';
import { updatePageRoom } from './pageRoom.js';

const NOT_FOUND = 1; // pdf.js FindState.NOT_FOUND
const $ = (id) => document.getElementById(id);

/** Text for the match counter: "N of M", "No matches" or nothing. */
export function formatMatchCount(matchesCount, findState) {
    if (matchesCount?.total > 0) return `${matchesCount.current} of ${matchesCount.total}`;
    return findState === NOT_FOUND ? 'No matches' : '';
}

const pressed = (id) => $(id).getAttribute('aria-pressed') === 'true';

function dispatchFind(type, findPrevious = false) {
    const tab = getActivePDF();
    if (!tab?.view) return;
    tab.view.eventBus.dispatch('find', {
        source: null,
        type,
        query: $('findInput').value,
        caseSensitive: pressed('findMatchCase'),
        entireWord: pressed('findWholeWord'),
        highlightAll: pressed('findHighlightAll'),
        findPrevious,
        matchDiacritics: false
    });
}

/** Binds the find bar controls; call once at startup. */
export function initFindBar() {
    const input = $('findInput');
    input.addEventListener('input', () => dispatchFind(''));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dispatchFind('again', e.shiftKey);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeFindBar();
        }
    });
    $('findNext').addEventListener('click', () => dispatchFind('again', false));
    $('findPrev').addEventListener('click', () => dispatchFind('again', true));
    const options = { findMatchCase: 'casesensitivitychange', findWholeWord: 'entirewordchange', findHighlightAll: 'highlightallchange' };
    for (const [id, type] of Object.entries(options)) {
        $(id).addEventListener('click', () => {
            $(id).setAttribute('aria-pressed', String(!pressed(id)));
            dispatchFind(type);
        });
    }
    $('findClose').addEventListener('click', () => closeFindBar());
}

/** True when el lies wholly in the view, clear of what its scroll padding keeps out (floats, the page pill). */
function inPlainSight(el, container) {
    const match = el.getBoundingClientRect();
    const view = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    const pad = (side) => parseFloat(style.getPropertyValue(`scroll-padding-${side}`)) || 0;
    return match.top >= view.top + pad('top') && match.bottom <= view.bottom - pad('bottom')
        && match.left >= view.left + pad('left') && match.right <= view.right - pad('right');
}

/**
 * pdf.js scrolls every new current match to the top of the view, even one in
 * plain sight, so the page jumped as find opened. It still runs (it clears its
 * own "scroll to it" flag) but without moving a page whose match is in view.
 */
function scrollOnlyToHiddenMatches({ findController, container }) {
    if (!findController?.scrollMatchIntoView || !container) return;
    const scrollMatchIntoView = findController.scrollMatchIntoView.bind(findController);
    findController.scrollMatchIntoView = (params) => {
        const el = params?.element;
        if (!el || !inPlainSight(el, container)) return scrollMatchIntoView(params);
        const own = Object.getOwnPropertyDescriptor(el, 'scrollIntoView');
        el.scrollIntoView = () => {};
        try {
            scrollMatchIntoView(params);
        } finally {
            if (own) Object.defineProperty(el, 'scrollIntoView', own);
            else delete el.scrollIntoView;
        }
    };
}

/** Routes a tab's find results to the bar while that tab is active. */
export function attachFindBar(tab) {
    scrollOnlyToHiddenMatches(tab.view);
    const show = (text) => {
        if (state.activeTabId === tab.id) $('findCount').textContent = text;
    };
    tab.view.eventBus.on('updatefindmatchescount', ({ matchesCount }) => show(formatMatchCount(matchesCount)));
    tab.view.eventBus.on('updatefindcontrolstate', ({ state: findState, matchesCount }) =>
        show(formatMatchCount(matchesCount, findState)));
}

/** Shows the bar (Ctrl+F) and focuses the query, re-running it if there is one. */
export function openFindBar() {
    if (!getActivePDF()?.view) return;
    $('findBar').classList.remove('hidden');
    $('findBtn')?.setAttribute('aria-pressed', 'true');
    updatePageRoom();
    const input = $('findInput');
    input.focus();
    input.select();
    if (input.value) dispatchFind('');
}

/** Clears the tab's find highlights; hides the bar if that tab is the active one. */
export function closeFindBar(tab = getActivePDF()) {
    tab?.view?.eventBus.dispatch('findbarclose', { source: null });
    if (!tab || state.activeTabId === tab.id) {
        $('findBar')?.classList.add('hidden');
        $('findBtn')?.setAttribute('aria-pressed', 'false');
        updatePageRoom();
        const count = $('findCount');
        if (count) count.textContent = '';
        tab?.view?.container?.focus({ preventScroll: true });
    }
}
