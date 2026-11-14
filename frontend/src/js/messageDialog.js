// The one alert dialog: a title, an optional severity icon, a message, optional
// details and a text field, and the actions right-aligned in the footer. The
// show* helpers below are the shapes the app uses.
import { iconSvg } from './icons.js';
import { trapFocus, rememberFocus } from './focusManager.js';

const ICONS = { success: 'circle-check', error: 'circle-alert', warning: 'triangle-alert' };
const $ = (id) => document.getElementById(id);

let current = null; // { finish(value), dismissValue }
let lastInputKeyboard = false;

/**
 * Focuses a dialog's first button. Opened with the pointer, it gets no ring
 * (browsers draw one for script focus) until a key is pressed.
 */
function focusQuietly(btn) {
    if (!lastInputKeyboard && btn.tagName === 'BUTTON') {
        btn.setAttribute('data-quiet-focus', '');
        const show = () => {
            btn.removeAttribute('data-quiet-focus');
            btn.removeEventListener('keydown', show);
            btn.removeEventListener('blur', show);
        };
        btn.addEventListener('keydown', show);
        btn.addEventListener('blur', show);
    }
    btn.focus();
}

/**
 * Shows the dialog and resolves the value of the action picked, or
 * dismissValue on Escape or a click outside it.
 *   tone      'info' | 'success' | 'warning' | 'error'; the last three show their icon
 *   icon      a neutral icon instead (e.g. 'lock')
 *   details   text shown in a collapsed "Details" disclosure (e.g. the raw OS error)
 *   input     { type, label, error } adds a text field; the confirm action resolves its value
 *   actions   [{ label, value, kind: 'primary' | 'danger', start: true puts it on the left }]
 *   focus     the value of the action focused first (default: the primary one)
 */
export function showDialog({ title, message = '', tone = 'info', icon = ICONS[tone], details = '', input = null, actions, dismissValue = null, focus }) {
    current?.finish(current.dismissValue);
    const dialog = $('messageDialog');
    const box = dialog.querySelector('.modal') ?? dialog;
    const titleEl = $('messageDialogTitle');
    const contentEl = $('messageDialogContent');
    const footer = $('messageDialogFooter');
    const iconEl = $('messageDialogIcon');

    box.dataset.tone = tone;
    dialog.setAttribute('role', tone === 'error' || tone === 'warning' ? 'alertdialog' : 'dialog');
    if (iconEl) {
        iconEl.innerHTML = icon ? iconSvg(icon) : '';
        iconEl.hidden = !icon;
    }
    titleEl.textContent = title;
    contentEl.textContent = message;
    contentEl.hidden = !message;

    const extra = [];
    let field = null;
    if (input) {
        const wrap = buildField(input);
        field = wrap.querySelector('input');
        extra.push(wrap);
    }
    if (details) extra.push(buildDetails(details));
    const more = $('messageDialogMore');
    if (more) more.replaceChildren(...extra);
    else contentEl.append(...extra);

    return new Promise((resolve) => {
        const restoreFocus = rememberFocus();
        const releaseTrap = trapFocus(box);
        const finish = (value) => {
            if (current?.finish !== finish) return;
            current = null;
            releaseTrap();
            dialog.classList.add('hidden');
            restoreFocus();
            resolve(value);
        };
        current = { finish, dismissValue };

        footer.replaceChildren();
        // A dangerous action is the solid confirm only when nothing else is.
        const classes = {
            primary: 'btn btn-primary',
            danger: actions.some((a) => a.kind === 'primary') ? 'btn btn-danger' : 'btn btn-destructive'
        };
        let focusTarget = field;
        for (const action of actions) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = classes[action.kind] ?? 'btn';
            if (action.start) btn.classList.add('footer-start');
            if (action.id) btn.id = action.id;
            btn.textContent = action.label;
            btn.addEventListener('click', () => finish(action.confirm && field ? field.value : action.value));
            footer.append(btn);
            if (!focusTarget && (focus === undefined ? action.kind === 'primary' : action.value === focus)) focusTarget = btn;
        }
        if (field) {
            field.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                finish(field.value);
            });
        }

        dialog.classList.remove('hidden');
        // After the key that opened the dialog is done, so it can't press the focused button.
        // Without a primary action the safe choice gets focus, never the dangerous one.
        focusTarget ??= [...footer.children].reverse().find((btn) => !btn.className.includes('danger') && !btn.className.includes('destructive'));
        setTimeout(() => focusTarget && focusQuietly(focusTarget), 0);
    });
}

function buildField({ type = 'text', label = '', error = '' }) {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-field';
    wrap.innerHTML = `
        <label class="field-label" for="messageDialogInput"></label>
        <div class="input-group">
            <input id="messageDialogInput" autocomplete="off" spellcheck="false">
        </div>
        <p class="field-error" id="messageDialogError"></p>`;
    const field = wrap.querySelector('input');
    field.type = type;
    wrap.querySelector('label').textContent = label;
    wrap.querySelector('label').hidden = !label;
    if (!label) field.setAttribute('aria-label', 'Value');
    const errorEl = wrap.querySelector('.field-error');
    errorEl.textContent = error;
    errorEl.hidden = !error;
    if (error) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', 'messageDialogError');
    }
    if (type === 'password') {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'icon-btn sm';
        reveal.setAttribute('aria-pressed', 'false');
        const sync = () => {
            const shown = field.type === 'text';
            reveal.setAttribute('aria-pressed', String(shown));
            reveal.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
            reveal.dataset.tip = shown ? 'Hide password' : 'Show password';
            reveal.innerHTML = iconSvg(shown ? 'eye-off' : 'eye', 'icon-sm');
        };
        reveal.addEventListener('click', () => {
            field.type = field.type === 'password' ? 'text' : 'password';
            sync();
            field.focus();
        });
        sync();
        wrap.querySelector('.input-group').append(reveal);
    }
    return wrap;
}

function buildDetails(text) {
    const details = document.createElement('details');
    details.className = 'details-box';
    details.innerHTML = `<summary>${iconSvg('chevron-right', 'icon-sm')}<span>Details</span></summary><pre class="details-box-body"></pre>`;
    details.querySelector('pre').textContent = text;
    return details;
}

/** An information, success, warning or error message with an OK button. */
export function showMessage(message, title = 'Message', type = 'info', { details = '' } = {}) {
    return showDialog({ title, message, tone: type, details, actions: [{ label: 'OK', value: undefined, kind: 'primary' }], dismissValue: undefined });
}

/**
 * Asks to confirm; resolves true or false. confirmLabel names the action
 * ("Replace"); danger marks it destructive, which also focuses Cancel.
 */
export function showConfirm(message, title = 'Confirm', { confirmLabel = 'OK', danger = false } = {}) {
    return showDialog({
        title,
        message,
        actions: [
            { label: 'Cancel', value: false },
            { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' }
        ],
        dismissValue: false,
        focus: danger ? false : undefined
    });
}

/**
 * One button per choice; resolves the chosen value, or null when dismissed.
 * choices: [{ label, value, primary?, danger?, start? }].
 */
export function showChoice(message, title, choices, { tone = 'info' } = {}) {
    return showDialog({
        title,
        message,
        tone,
        actions: choices.map((c) => ({ label: c.label, value: c.value, start: c.start, kind: c.primary ? 'primary' : c.danger ? 'danger' : undefined })),
        dismissValue: null
    });
}

/**
 * Asks for a line of text. Resolves the entered string, or null when
 * cancelled. options: type ('password'), label, error (shown under the
 * field), confirmLabel, icon.
 */
export function showPrompt(message, title, { type = 'text', label = '', error = '', confirmLabel = 'OK', icon } = {}) {
    return showDialog({
        title,
        message,
        icon,
        input: { type, label, error },
        actions: [
            { label: 'Cancel', value: null, id: 'messageDialogCancel' },
            { label: confirmLabel, confirm: true, kind: 'primary', id: 'messageDialogOk' }
        ],
        dismissValue: null
    });
}

/** Escape and a click outside the dialog dismiss it. */
export function initMessageDialog() {
    const dialog = $('messageDialog');
    document.addEventListener('keydown', () => { lastInputKeyboard = true; }, true);
    document.addEventListener('pointerdown', () => { lastInputKeyboard = false; }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current && !dialog.classList.contains('hidden')) {
            // Only this dialog closes, not the one it was opened over.
            e.stopImmediatePropagation();
            current.finish(current.dismissValue);
        }
    });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) current?.finish(current.dismissValue);
    });
}
