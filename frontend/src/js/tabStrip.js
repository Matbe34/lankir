// The document tab strip in the header: tabs are as wide as their names while
// there is room; when the strip is full the other tabs share it equally and
// names lose their middle (the end tells similar files apart), and a tab that would be cut below --tab-min-w goes to
// the "N more tabs" menu instead (never the active one).
import { bindMenu } from './menus.js';

const $ = (id) => document.getElementById(id);

/** The name a tab shows: the file name without ".pdf". */
export function tabLabel(name) {
    return name.replace(/(.)\.pdf$/i, '$1');
}

// The end a cut name keeps: its last word when that word is short, else its last letters.
function tailOf(label) {
    const end = label.slice(-12);
    const space = end.indexOf(' ');
    const tail = space === -1 ? label.slice(-9) : end.slice(space + 1);
    return tail.replace(/^[\s\-–—_]+/, '') || tail;
}

const SEPARATORS = /[\s\-–—_]/;

/**
 * Where a head too wide for room px ends: after its last whole letter that
 * fits, less any spaces and separators before it. rightOf(n) is how far its
 * first n letters reach. Null when it all fits.
 */
export function headCut(text, rightOf, room) {
    if (rightOf(text.length) <= room) return null;
    let end = 0;
    while (end < text.length && rightOf(end + 1) <= room) end++;
    while (end > 0 && SEPARATORS.test(text[end - 1])) end--;
    return { end, shown: rightOf(end) };
}

// The browser's own ellipsis leaves the rest of a cut head's box empty, a
// hole before the tail. So a cut head is clipped after its last whole letter
// and the tail, "…" first, closes up to it (.is-cut, components.css).
function fitName(name) {
    const head = name.querySelector('.truncate-head');
    const text = head?.firstChild;
    name.classList.remove('is-cut');
    if (!text || head.scrollWidth <= head.clientWidth) return;
    name.classList.add('is-cut');
    const left = head.getBoundingClientRect().left;
    const range = document.createRange();
    range.setStart(text, 0);
    const rightOf = (n) => {
        range.setEnd(text, n);
        return n ? range.getBoundingClientRect().right - left : 0;
    };
    const room = head.getBoundingClientRect().width;
    const cut = headCut(text.data, rightOf, room);
    if (!cut) {
        name.classList.remove('is-cut');
        return;
    }
    name.style.setProperty('--head-shown', `${cut.shown}px`);
    name.style.setProperty('--head-gap', `${room - cut.shown}px`);
}

const fitter = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => entries.forEach((entry) => fitName(entry.target)))
    : null;
// The names fitter follows, each marked once seen in the page: one that has
// left it since (its tab closed, the menu refilled) is let go. A name not in
// the page yet is kept, as a new tab's is until it is added.
const followed = new Map();
function forgetRemovedNames() {
    for (const [el, seen] of followed) {
        if (el.isConnected) followed.set(el, true);
        else if (seen) {
            fitter.unobserve(el);
            followed.delete(el);
        }
    }
}

/** Shows a file name as a tab label in el, cut in the middle when it doesn't fit so its end stays. */
export function setTabName(el, name) {
    const label = tabLabel(name);
    const tail = tailOf(label);
    const head = document.createElement('span');
    head.className = 'truncate-head';
    head.textContent = label.slice(0, label.length - tail.length);
    const end = document.createElement('span');
    end.className = 'truncate-tail';
    end.textContent = tail;
    el.classList.remove('truncate');
    el.classList.add('truncate-middle');
    el.dataset.name = name;
    el.replaceChildren(head, end);
    if (!fitter) return;
    fitter.observe(el);
    if (!followed.has(el)) followed.set(el, false);
}

const tabs = () => [...document.querySelectorAll('#pdfTabsContainer .pdf-tab')];
const nameOf = (tab) => tab.querySelector('.pdf-tab-name');

const overflows = (strip) => strip.scrollWidth > strip.clientWidth + 1;
const minWidth = (strip) => parseFloat(getComputedStyle(strip).getPropertyValue('--tab-min-w')) || 140;
const maxWidth = (tab) => parseFloat(getComputedStyle(tab).maxWidth) || Infinity;
// A tab's width with its whole name: only the head of a cut name shrinks.
const shrinking = (tab) => nameOf(tab).querySelector('.truncate-head') || nameOf(tab);
const naturalWidth = (tab) => tab.offsetWidth - shrinking(tab).clientWidth + shrinking(tab).scrollWidth;
// A shown tab cut for want of room, or narrower than the least width (a short
// name may be narrower whole). --tab-max-w cuts long names anyway.
const cut = (tab, least = Infinity) => !tab.hidden
    && tab.offsetWidth < Math.min(least, naturalWidth(tab), maxWidth(tab)) - 0.5;
const cramped = (strip, least) => overflows(strip) || tabs().some((tab) => cut(tab, least));

/**
 * Shows as many tabs as fit without cutting a name below the least width,
 * always the active one: tabs after it go to the "N more tabs" menu first,
 * then tabs before it. Once names are cut, the strip is full: the shown tabs
 * other than the active one share its width equally (.is-full). Re-run
 * whenever tabs or the window change.
 */
export function refreshTabStrip() {
    const strip = $('pdfTabsContainer');
    const button = $('tabOverflowBtn');
    if (!strip || !button) return;
    forgetRemovedNames();
    const all = tabs();
    strip.classList.remove('is-full');
    button.classList.add('hidden');
    for (const tab of all) tab.hidden = false;
    let hidden = 0;
    const least = minWidth(strip);
    const full = overflows(strip) || all.some((tab) => cut(tab));
    strip.classList.toggle('is-full', full);
    if (full && cramped(strip, least)) {
        // Measure with the button in place, so the tabs left keep the least width.
        button.classList.remove('hidden');
        const active = all.findIndex((tab) => tab.classList.contains('active'));
        const order = [...all.slice(active + 1).reverse(), ...all.slice(0, Math.max(active, 0))];
        for (const tab of order) {
            if (!cramped(strip, least)) break;
            tab.hidden = true;
            hidden++;
        }
    }
    button.classList.toggle('hidden', hidden === 0);
    const count = $('tabOverflowCount');
    if (count) count.textContent = `${hidden} more ${hidden === 1 ? 'tab' : 'tabs'}`;
}

function fillOverflowMenu(menu, onSelect) {
    menu.replaceChildren(...tabs().map((tab) => {
        const item = document.createElement('button');
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(tab.classList.contains('active')));
        const label = document.createElement('span');
        label.className = 'menu-label';
        const name = nameOf(tab).dataset.name;
        setTabName(label, name);
        item.dataset.tip = tab.dataset.tip || name;
        item.append(label);
        item.addEventListener('click', () => onSelect(Number(tab.dataset.tabId)));
        return item;
    }));
    forgetRemovedNames();
}

/** Binds the overflow menu and follows the window's width; call once at startup. */
export function initTabStrip({ onSelect }) {
    const button = $('tabOverflowBtn');
    const menu = $('tabOverflowMenu');
    if (!button || !menu) return;
    bindMenu(button, menu, { onOpen: () => fillOverflowMenu(menu, onSelect), focusItem: () => menu.querySelector('[aria-checked="true"]') });
    window.addEventListener('resize', () => refreshTabStrip());
}
