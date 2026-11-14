// One tooltip for every [data-tip] element: its text plus its shortcut keys,
// shown after a short hover or on keyboard focus.
import { keysFor, keycaps } from './shortcuts.js';

const DELAY = 500;
const GAP = 8;
let tip = null;
let timer = null;
let target = null;

function hide() {
    clearTimeout(timer);
    timer = null;
    target = null;
    tip?.remove();
}

function show(el) {
    if (!el.isConnected) return;
    tip ??= Object.assign(document.createElement('div'), { className: 'tooltip', role: 'tooltip' });
    tip.replaceChildren(document.createTextNode(el.dataset.tip));
    const keys = keysFor(el);
    if (keys.length) tip.append(keycaps(keys));
    document.body.append(tip);

    const rect = el.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const below = rect.bottom + GAP + box.height < window.innerHeight - GAP;
    const top = below ? rect.bottom + GAP : rect.top - GAP - box.height;
    const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - box.width / 2), window.innerWidth - box.width - GAP);
    Object.assign(tip.style, { top: `${top}px`, left: `${left}px` });
}

function schedule(el, delay) {
    if (el === target) return;
    hide();
    target = el;
    timer = setTimeout(() => show(el), delay);
}

/** Starts showing tooltips; call once. */
export function initTooltips() {
    document.addEventListener('pointerover', (e) => {
        const el = e.target.closest?.('[data-tip]');
        if (!el) {
            if (target) hide();
            return;
        }
        if (el.matches(':disabled, [aria-expanded="true"]')) {
            hide();
            return;
        }
        // Moving between neighbours while one tip is up swaps at once.
        schedule(el, tip?.isConnected ? 0 : DELAY);
    });
    document.addEventListener('focusin', (e) => {
        const el = e.target.closest?.('[data-tip]');
        if (el && e.target.matches(':focus-visible')) schedule(el, DELAY);
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
}
