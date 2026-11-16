// The dialogs of the document tools (Split, Insert, Protect, Properties): a
// title with a close button, a body the caller fills, and the actions in the
// footer. One is open at a time; it closes before any message dialog shows.
import { iconSvg } from './icons.js';
import { trapFocus, rememberFocus, getFocusableElements } from './focusManager.js';

let current = null;

/**
 * Shows a dialog and resolves what it closed with: null for Escape, the
 * close button, Cancel or a click on the scrim.
 *   id       the dialog's element id
 *   title    its heading
 *   size     'sm' (420px) or '' (480px) or 'md' (520px)
 *   body     nodes for the body
 *   actions  [{ label, value, kind: 'primary', start }]; a null value cancels
 *   onAction async (value, dialog) => result: undefined or false keeps the
 *            dialog open (e.g. a field to fix), anything else closes it with that
 *   focus    the element focused first (default: the first field, else the primary action)
 * Returns { root, footer, primary, close(value), done }.
 */
export function openDialog({ id, title, size = '', body = [], actions, onAction = async (value) => value, focus }) {
    current?.close(null);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = id;
    const box = document.createElement('div');
    box.className = `modal${size ? ` modal-${size}` : ''}`;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', `${id}Title`);
    box.innerHTML = `
        <div class="modal-header"><h2 id="${id}Title"></h2><button type="button" class="modal-close" aria-label="Close">${iconSvg('x')}</button></div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>`;
    box.querySelector('h2').textContent = title;
    box.querySelector('.modal-body').append(...body);
    const footer = box.querySelector('.modal-footer');
    overlay.append(box);

    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const restoreFocus = rememberFocus();
    const releaseTrap = trapFocus(box);
    const dialog = { root: overlay, footer, primary: null, done };
    dialog.close = (value) => {
        if (current !== dialog) return;
        current = null;
        releaseTrap();
        overlay.remove();
        restoreFocus();
        resolve(value);
    };

    let busy = false;
    const act = async (value) => {
        if (value === null) return dialog.close(null);
        if (busy) return;
        busy = true;
        try {
            const result = await onAction(value, dialog);
            if (result !== undefined && result !== false) dialog.close(result);
        } finally {
            busy = false;
        }
    };
    for (const action of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = action.kind === 'primary' ? 'btn btn-primary' : 'btn';
        if (action.start) btn.classList.add('footer-start');
        btn.textContent = action.label;
        btn.addEventListener('click', () => act(action.value));
        footer.append(btn);
        if (action.kind === 'primary') dialog.primary = btn;
    }

    box.querySelector('.modal-close').addEventListener('click', () => dialog.close(null));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dialog.close(null);
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Only this dialog closes: not a menu or panel under it.
            e.preventDefault();
            e.stopPropagation();
            dialog.close(null);
        } else if (e.key === 'Enter' && e.target.matches('input:not([type="checkbox"])') && dialog.primary && !dialog.primary.disabled) {
            e.preventDefault();
            dialog.primary.click();
        }
    });

    current = dialog;
    document.body.append(overlay);
    const first = focus ?? getFocusableElements(box.querySelector('.modal-body')).find((el) => el.matches('input')) ?? dialog.primary;
    // A focused button shows no ring until a key is pressed (see feedback.css).
    if (first?.tagName === 'BUTTON') {
        first.setAttribute('data-quiet-focus', '');
        const show = () => first.removeAttribute('data-quiet-focus');
        first.addEventListener('keydown', show, { once: true });
        first.addEventListener('blur', show, { once: true });
    }
    // After the key that opened the dialog is done, so it can't type into the field.
    setTimeout(() => current === dialog && first?.focus(), 0);
    return dialog;
}

/** Closes the open dialog as Escape would. Returns true when one was open. */
export function closeOpenDialog() {
    if (!current) return false;
    current.close(null);
    return true;
}

/** Builds an element from HTML for a dialog's body. */
export function fragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return [...template.content.childNodes];
}
