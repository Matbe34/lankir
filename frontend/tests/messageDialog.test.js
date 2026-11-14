import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { initMessageDialog, showChoice, showConfirm, showMessage, showPrompt } from '../src/js/messageDialog.js';

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

beforeEach(() => {
  document.body.innerHTML = body;
  initMessageDialog();
});

const $ = (sel) => document.querySelector(sel);
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
const footerButtons = () => [...document.querySelectorAll('#messageDialogFooter button')];
const isOpen = () => !$('#messageDialog').classList.contains('hidden');

describe('showMessage', () => {
  it('shows the severity icon for errors and none for plain information', async () => {
    let done = showMessage('Disk full', 'Lankir couldn’t save “a.pdf”', 'error');
    expect($('#messageDialogIcon').hidden).toBe(false);
    expect($('#messageDialog').getAttribute('role')).toBe('alertdialog');
    expect($('#messageDialogTitle').textContent).toBe('Lankir couldn’t save “a.pdf”');
    footerButtons()[0].click();
    await done;

    done = showMessage('Saved', 'Settings');
    expect($('#messageDialogIcon').hidden).toBe(true);
    expect($('#messageDialog').getAttribute('role')).toBe('dialog');
    pressEscape();
    await done;
  });

  it('focuses its button and gives focus back when closed', async () => {
    vi.useFakeTimers();
    const before = $('#openBtn');
    before.focus();
    const done = showMessage('Hi', 'Note');
    vi.runAllTimers();
    expect(document.activeElement).toBe(footerButtons()[0]);
    footerButtons()[0].click();
    await done;
    expect(document.activeElement).toBe(before);
    vi.useRealTimers();
  });
});

describe('focus ring', () => {
  const opened = async (before) => {
    vi.useFakeTimers();
    before();
    const done = showMessage('Hi', 'Note');
    vi.runAllTimers();
    vi.useRealTimers();
    const button = footerButtons()[0];
    expect(document.activeElement).toBe(button);
    return { button, done };
  };

  it('stays off the first button of a dialog opened with the pointer, until a key is pressed', async () => {
    const { button, done } = await opened(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(button.hasAttribute('data-quiet-focus')).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(button.hasAttribute('data-quiet-focus')).toBe(false);
    button.click();
    await done;
  });

  it('shows on the first button of a dialog opened from the keyboard', async () => {
    const { button, done } = await opened(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })));
    expect(button.hasAttribute('data-quiet-focus')).toBe(false);
    button.click();
    await done;
  });
});

describe('showChoice', () => {
  it('resolves the value of the clicked button', async () => {
    const result = showChoice('Save?', 'Unsaved', [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'save', primary: true }
    ]);
    footerButtons().find((b) => b.textContent === 'Save').click();
    expect(await result).toBe('save');
    expect(isOpen()).toBe(false);
  });

  it('resolves null when dismissed with Escape', async () => {
    const result = showChoice('Save?', 'Unsaved', [{ label: 'Save', value: 'save' }]);
    pressEscape();
    expect(await result).toBeNull();
  });

  it('weights the buttons: one accent, destructive in danger, an aside on the left', async () => {
    const result = showChoice('Changes are lost.', 'Save changes?', [
      { label: 'Don’t save', value: 'discard', danger: true, start: true },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'save', primary: true }
    ]);
    const [discard, cancel, save] = footerButtons();
    expect(discard.className).toBe('btn btn-danger footer-start');
    expect(cancel.className).toBe('btn');
    expect(save.className).toBe('btn btn-primary');
    cancel.click();
    expect(await result).toBe('cancel');
  });
});

describe('showConfirm', () => {
  it('resolves false when dismissed with Escape and true on confirm', async () => {
    let result = showConfirm('Sure?');
    pressEscape();
    expect(await result).toBe(false);
    result = showConfirm('Replace it?', 'Replace “a.pdf”?', { confirmLabel: 'Replace', danger: true });
    expect(footerButtons().map((b) => b.textContent)).toEqual(['Cancel', 'Replace']);
    expect(footerButtons()[1].className).toBe('btn btn-destructive');
    footerButtons()[1].click();
    expect(await result).toBe(true);
  });
});

describe('showPrompt', () => {
  it('resolves the typed text on OK and null on cancel', async () => {
    let result = showPrompt('Password?', 'Locked', { type: 'password' });
    const input = $('#messageDialog input');
    expect(input.type).toBe('password');
    input.value = 'secret';
    document.getElementById('messageDialogOk').click();
    expect(await result).toBe('secret');

    result = showPrompt('Password?', 'Locked');
    document.getElementById('messageDialogCancel').click();
    expect(await result).toBeNull();
  });

  it('labels the field, shows an error under it and can reveal a password', async () => {
    const result = showPrompt('This document is protected.', '“a.pdf” needs a password', {
      type: 'password', label: 'Password', error: 'That password isn’t right. Try again.', confirmLabel: 'Open'
    });
    const input = $('#messageDialogInput');
    expect($('label[for="messageDialogInput"]').textContent).toBe('Password');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect($('#messageDialogError').textContent).toBe('That password isn’t right. Try again.');
    const reveal = $('#messageDialog [aria-label="Show password"]');
    reveal.click();
    expect(input.type).toBe('text');
    input.value = 'pw';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await result).toBe('pw');
  });
});
