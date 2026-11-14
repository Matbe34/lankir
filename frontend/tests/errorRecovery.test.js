import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { initMessageDialog } from '../src/js/messageDialog.js';
import { showOpenError, plainReason } from '../src/js/errorRecovery.js';

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel) => document.querySelector(sel);
const buttons = () => [...document.querySelectorAll('#messageDialogFooter button')];

beforeEach(() => {
  document.body.innerHTML = body;
  initMessageDialog();
});

describe('showOpenError', () => {
  it('says what failed in words, with the raw error under Details', async () => {
    const onChooseAnother = vi.fn();
    const done = showOpenError(new Error('open /home/me/Documents/Quarterly report.pdf: permission denied'), { onChooseAnother });

    expect($('#messageDialogTitle').textContent).toBe('Lankir couldn’t open “Quarterly report.pdf”');
    expect($('#messageDialogContent').textContent).toBe('You don’t have permission to read this file.');
    const details = $('#messageDialog details');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary').textContent).toBe('Details');
    expect(details.querySelector('pre').textContent).toBe('open /home/me/Documents/Quarterly report.pdf: permission denied');
    // Choosing another file is the way forward, so it is the confirm; OK just closes.
    expect(buttons().map((b) => b.textContent)).toEqual(['OK', 'Choose another file…']);
    expect(buttons()[1].className).toContain('btn-primary');
    expect(buttons()[0].className).not.toContain('btn-primary');
    expect($('#messageDialogIcon svg')).not.toBeNull();

    buttons()[1].click();
    await done;
    expect(onChooseAnother).toHaveBeenCalled();
  });

  it('just closes on Escape, without asking for another file', async () => {
    const onChooseAnother = vi.fn();
    const done = showOpenError(new Error('Invalid PDF structure.'), { onChooseAnother });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await done;
    expect(onChooseAnother).not.toHaveBeenCalled();
  });

  it('names the file it was given and falls back to a general reason', async () => {
    const done = showOpenError(new Error('weird failure 42'), { path: '/x/Lease.pdf' });
    expect($('#messageDialogTitle').textContent).toBe('Lankir couldn’t open “Lease.pdf”');
    expect($('#messageDialogContent').textContent).toBe('Something went wrong while reading the file.');
    expect(buttons().map((b) => b.textContent)).toEqual(['OK']);
    buttons()[0].click();
    await done;
  });
});

describe('plainReason', () => {
  it.each([
    ['stat /a/b.pdf: no such file or directory', 'The file isn’t there any more. It may have been moved, renamed or deleted.'],
    ['Invalid PDF structure.', 'The file is damaged or isn’t a PDF.'],
    ['/files/doc1.pdf is read-only', 'The file is read-only.'],
    ['write /x.pdf: no space left on device', 'There’s no space left on the disk.']
  ])('%s', (raw, reason) => {
    expect(plainReason(new Error(raw))).toBe(reason);
  });

  it('returns null for errors it does not know', () => {
    expect(plainReason(new Error('disk full'))).toBeNull();
  });
});
