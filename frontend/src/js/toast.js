// Short notices ("Saved", "Signed"), stacked bottom right above the page pill.
// Without a #toastRegion (tests) they do nothing.
import { iconSvg } from './icons.js';

const ICONS = { info: 'info', success: 'circle-check', warning: 'triangle-alert', error: 'circle-alert' };
const MAX = 3;

/**
 * Shows message for timeout ms (errors stay until dismissed when timeout is 0).
 * tone: 'info' | 'success' | 'warning' | 'error'. action: { label, run } adds a
 * button that runs it and dismisses the toast.
 */
export function showToast(message, { tone = 'info', timeout = 4000, action = null } = {}) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    toast.innerHTML = `${iconSvg(ICONS[tone] ?? ICONS.info)}<span class="toast-text"></span>`;
    const text = toast.querySelector('.toast-text');
    text.textContent = message;
    text.title = message;

    let timer = null;
    const dismiss = () => {
        clearTimeout(timer);
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 200);
    };
    const arm = () => {
        clearTimeout(timer);
        if (timeout > 0) timer = setTimeout(dismiss, timeout);
    };

    if (action) {
        const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-ghost btn-sm toast-action', textContent: action.label });
        btn.addEventListener('click', () => {
            dismiss();
            action.run();
        });
        toast.append(btn);
    }
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn sm', innerHTML: iconSvg('x', 'icon-sm') });
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', dismiss);
    toast.append(close);

    // Pointer or keyboard on the toast holds it open.
    toast.addEventListener('pointerenter', () => clearTimeout(timer));
    toast.addEventListener('pointerleave', arm);
    toast.addEventListener('focusin', () => clearTimeout(timer));
    toast.addEventListener('focusout', arm);

    region.append(toast);
    while (region.children.length > MAX) region.firstElementChild.remove();
    arm();
}
