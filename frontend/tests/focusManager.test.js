import { describe, it, expect } from 'vitest';
import { trapFocus } from '../src/js/focusManager.js';

const tab = (target, shiftKey = false) => !target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));

describe('trapFocus', () => {
  it('brings Tab back into the dialog once focus has left it', () => {
    document.body.innerHTML = '<button id="outside">Outside</button><div id="dialog"><button id="first">A</button><button id="last">B</button></div>';
    const release = trapFocus(document.getElementById('dialog'));

    document.activeElement?.blur();
    expect(tab(document.body)).toBe(true);
    expect(document.activeElement.id).toBe('first');
    document.activeElement.blur();
    expect(tab(document.body, true)).toBe(true);
    expect(document.activeElement.id).toBe('last');

    release();
    document.activeElement.blur();
    expect(tab(document.body)).toBe(false);
  });
});
