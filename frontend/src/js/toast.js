// Short notices ("Saved", "Signed"), all one width, stacked bottom right
// level with the page pill, or lifted above it when they'd sit close beside it. Without
// a #toastRegion (tests) they do nothing.
import { iconSvg } from './icons.js';
import { keycaps } from './shortcuts.js';

const INSET = 16; // the region's inset from the window's right edge (--sp-4)
const GAP = 12; // between a lifted stack and the pill (--sp-3)
const CLEAR = 48; // the least room beside the pill; closer, the two read as one cramped bar

/**
 * Where a stack stack px wide goes in a window width × height with the page
 * pill at pill (a rect, or null): null for bottom right, level with the pill;
 * { bottom } px to lift it above the pill when it would come within CLEAR px.
 */
export function toastPlacement({ pill, stack, width, height }) {
    if (!pill || width - INSET - stack >= pill.right + CLEAR) return null;
    return { bottom: height - pill.top + GAP };
}

/** Places the toasts again; pageRoom.js and organize.js call it when the page pill moves or changes. */
export function placeToasts(region = document.getElementById('toastRegion')) {
    if (!region) return;
    const pill = [...document.querySelectorAll('.page-pill')].find((el) => el.getClientRects().length && !el.classList.contains('hidden'));
    const place = region.children.length && pill
        ? toastPlacement({ pill: pill.getBoundingClientRect(), stack: region.getBoundingClientRect().width, width: window.innerWidth, height: window.innerHeight })
        : null;
    region.classList.toggle('is-lifted', Boolean(place));
    region.style.setProperty('--toast-bottom', place ? `${place.bottom}px` : '');
}

let followsResize = false;

const ICONS = { info: 'info', success: 'circle-check', warning: 'triangle-alert', error: 'circle-alert' };
const MAX = 3;

/**
 * Shows message for timeout ms (errors stay until dismissed when timeout is 0).
 * tone: 'info' | 'success' | 'warning' | 'error'; icon replaces the tone's
 * icon. action: { label, run } adds a button that runs it and dismisses the
 * toast; actions adds several, and one with keys ("Ctrl S") is the bordered
 * one that shows its shortcut. Returns { update(message), shown(), dismiss() }: a
 * toast that reports progress changes its text (and its timeout starts again),
 * shown() tells whether it is still up, and dismiss resolves once it is gone. progress (0 to 1) adds a bar that update(message, progress) moves;
 * closable: false leaves out the × (for a job its Cancel action stops).
 */
export function showToast(message, { tone = 'info', timeout = 4000, action = null, actions = action ? [action] : [], icon = null, progress = null, closable = true } = {}) {
    const region = document.getElementById('toastRegion');
    if (!region) return { update() {}, shown: () => false, dismiss: async () => {} };
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    toast.innerHTML = `${iconSvg(icon ?? ICONS[tone] ?? ICONS.info)}<span class="toast-text"></span>`;
    if (!closable) toast.dataset.pinned = '';
    const text = toast.querySelector('.toast-text');
    text.textContent = message;
    text.title = message;

    let timer = null;
    // Pointer or keyboard on the toast holds it open.
    let held = false;
    // Resolves once the toast has faded out and left the page.
    const dismiss = () => new Promise((resolve) => {
        clearTimeout(timer);
        toast.classList.add('leaving');
        setTimeout(() => {
            toast.remove();
            placeToasts(region);
            resolve();
        }, 200);
    });
    const arm = () => {
        clearTimeout(timer);
        if (timeout > 0 && !held) timer = setTimeout(dismiss, timeout);
    };
    const hold = (on) => {
        held = on;
        arm();
    };

    for (const { label, run, keys } of actions) {
        const btn = Object.assign(document.createElement('button'), {
            type: 'button', className: `btn ${keys ? '' : 'btn-ghost '}btn-sm toast-action`, textContent: label
        });
        if (keys) btn.append(keycaps(keys.split(' ')));
        btn.addEventListener('click', () => {
            dismiss();
            run();
        });
        toast.append(btn);
    }
    if (closable) {
        const close = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn sm', innerHTML: iconSvg('x', 'icon-sm') });
        close.setAttribute('aria-label', 'Dismiss');
        close.addEventListener('click', dismiss);
        toast.append(close);
    }
    let bar = null;
    const setProgress = (value) => {
        bar.style.setProperty('--progress', String(value));
        bar.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    };
    if (progress !== null) {
        bar = Object.assign(document.createElement('span'), { className: 'toast-progress' });
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        setProgress(progress);
        toast.append(bar);
    }

    toast.addEventListener('pointerenter', () => hold(true));
    toast.addEventListener('pointerleave', () => hold(false));
    toast.addEventListener('focusin', () => hold(true));
    toast.addEventListener('focusout', () => hold(false));

    region.append(toast);
    // A toast without a × goes only when its job ends; its Cancel may be the job's only stop.
    let excess = region.children.length - MAX;
    for (const old of [...region.children]) {
        if (excess <= 0) break;
        if (old.dataset.pinned === undefined) {
            old.remove();
            excess--;
        }
    }
    placeToasts(region);
    if (!followsResize) {
        followsResize = true;
        window.addEventListener('resize', () => placeToasts(region));
    }
    arm();
    return {
        update(next, value = null) {
            text.textContent = next;
            text.title = next;
            if (bar && value !== null) setProgress(value);
            placeToasts(region);
            arm();
        },
        shown: () => toast.isConnected && !toast.classList.contains('leaving'),
        dismiss
    };
}

/** Says why Save or Print didn't start: a page change, save or print still holds the tab. */
let busyToast = null;
export function showBusy() {
    const message = 'Wait for the current change to finish';
    if (busyToast?.shown()) busyToast.update(message);
    else busyToast = showToast(message);
}
