// Focus for dialogs: keep Tab inside the open one and give focus back to where
// it was when it closes.
const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'summary',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

/** The elements Tab can reach inside container, in order. */
export function getFocusableElements(container) {
    return [...container.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('.hidden, [hidden], details:not([open]) > :not(summary)'));
}

/**
 * Keeps Tab and Shift+Tab inside container, from wherever focus is, even
 * outside it. Returns a function that stops it.
 */
export function trapFocus(container) {
    const onKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        const items = getFocusableElements(container);
        if (items.length === 0) {
            e.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const inside = container.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
            e.preventDefault();
            first.focus();
        }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
}

/**
 * Remembers what has focus now and returns a function that gives it back.
 * An item of a menu that has since closed hands back to the menu's button.
 */
export function rememberFocus() {
    let el = document.activeElement;
    const menu = el?.closest?.('[role="menu"]');
    if (menu?.id) el = document.querySelector(`[aria-controls="${menu.id}"]`) ?? el;
    return () => {
        if (el && el !== document.body && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    };
}
