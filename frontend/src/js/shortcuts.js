// Shortcut hints shown as keycaps in menus and tooltips. Elements carry either
// data-keys="Ctrl Shift S" (fixed) or data-shortcut="sign" (the user's setting).
import { getSetting } from './settings.js';

const DEFAULTS = {
    openFile: 'Control+o',
    sign: 'Alt+s',
    zoomIn: 'Control+Plus',
    zoomOut: 'Control+Minus',
    nextTab: 'Control+Tab',
    newWindow: 'Control+Shift+n',
    commandPalette: 'Control+k',
    print: 'Control+p',
    organizePages: 'Control+Shift+o'
};

const NAMES = { control: 'Ctrl', ctrl: 'Ctrl', meta: 'Super', plus: '+', minus: '−', escape: 'Esc', space: 'Space' };

/** "Control+Shift+n" -> ["Ctrl", "Shift", "N"]. */
export function formatShortcut(shortcut) {
    if (!shortcut) return [];
    return shortcut.split('+').map((p) => p.trim()).filter(Boolean)
        .map((p) => NAMES[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p));
}

/** The keys for an element's data-keys or data-shortcut, or []. */
export function keysFor(el) {
    if (el.dataset.keys) return el.dataset.keys.split(' ');
    const name = el.dataset.shortcut;
    if (!name) return [];
    return formatShortcut((getSetting('shortcuts') || {})[name] || DEFAULTS[name]);
}

/** Keycap markup for a list of keys. */
export function keycaps(keys) {
    const span = document.createElement('span');
    span.className = 'keys';
    for (const key of keys) span.append(Object.assign(document.createElement('kbd'), { textContent: key }));
    return span;
}

/** Fills every .keys[data-keys] / .keys[data-shortcut] under root with keycaps. */
export function renderShortcutHints(root = document) {
    for (const el of root.querySelectorAll('.keys[data-keys], .keys[data-shortcut]')) {
        el.replaceChildren(...keycaps(keysFor(el)).childNodes);
    }
}
