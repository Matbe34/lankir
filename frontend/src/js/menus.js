// Popup menus opened from a button: one open at a time, placed next to the
// button, closed by picking an item, Escape, Tab or a click elsewhere.
// Arrow keys, Home and End move between items.
const GAP = 4;
let current = null; // { button, menu, close }

const ITEM = ':is([role="menuitem"], [role="menuitemradio"]):not(:disabled)';
const items = (menu) => [...menu.querySelectorAll(ITEM)];

function place(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    Object.assign(menu.style, { position: 'fixed', top: '', bottom: '', left: '', right: '' });
    if (menu.classList.contains('menu-up')) menu.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
    else menu.style.top = `${rect.bottom + GAP}px`;
    if (menu.classList.contains('menu-end')) menu.style.right = `${window.innerWidth - rect.right}px`;
    else menu.style.left = `${rect.left}px`;
}

/** Closes the open menu, if any. Returns true when one was open. */
export function closeOpenMenu({ focusButton = false } = {}) {
    if (!current) return false;
    current.close(focusButton);
    return true;
}

/**
 * Makes button open menu. onOpen runs (and may be async) each time it opens;
 * anchor is the element the menu lines up with (default the button);
 * focusItem returns the item keyboard opening focuses (default the first).
 */
export function bindMenu(button, menu, { onOpen, anchor = button, focusItem } = {}) {
    if (!button || !menu) return;
    const close = (focusButton) => {
        menu.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        if (current?.menu === menu) current = null;
        if (focusButton) button.focus();
    };
    const open = async (fromKeyboard) => {
        closeOpenMenu();
        current = { button, menu, close };
        button.setAttribute('aria-expanded', 'true');
        menu.classList.remove('hidden');
        place(menu, anchor || button);
        await onOpen?.();
        if (current?.menu !== menu) return;
        place(menu, anchor || button);
        if (fromKeyboard) (focusItem?.() || items(menu)[0])?.focus();
    };

    button.addEventListener('click', (e) => {
        if (current?.menu === menu) close(false);
        else open(e.detail === 0);
    });
    button.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && current?.menu !== menu) {
            e.preventDefault();
            open(true);
        }
    });
    menu.addEventListener('click', (e) => {
        if (e.target.closest(ITEM)) close(false);
    });
    menu.addEventListener('keydown', (e) => {
        const list = items(menu);
        const index = list.indexOf(document.activeElement);
        const move = (to) => {
            e.preventDefault();
            list[(to + list.length) % list.length]?.focus();
        };
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                close(true);
                break;
            case 'Tab':
                close(false);
                break;
            case 'ArrowDown':
                move(index + 1);
                break;
            case 'ArrowUp':
                move(index < 0 ? -1 : index - 1);
                break;
            case 'Home':
                move(0);
                break;
            case 'End':
                move(-1);
                break;
        }
    });
}

document.addEventListener('pointerdown', (e) => {
    if (!current) return;
    if (current.menu.contains(e.target) || current.button.contains(e.target)) return;
    closeOpenMenu();
}, true);
window.addEventListener('resize', () => closeOpenMenu());
window.addEventListener('blur', () => closeOpenMenu());
