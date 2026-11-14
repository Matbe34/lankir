import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { state, createPDFData } from '../src/js/state.js';
import { SignatureService } from '../src/js/backend.js';

// The real message dialog: one box on the page that every prompt shares.
const saveTab = vi.fn(async () => true);
vi.mock('../src/js/documents.js', () => ({
  openRecentFile: vi.fn(async () => 9),
  closeTab: vi.fn(async () => true),
  saveTab: (...a) => saveTab(...a),
  refreshDirty: (tab) => !!tab?.dirty
}));
vi.mock('../src/js/settings.js', () => ({ getSetting: (k) => k === 'checkRevocationOnline', setSetting: vi.fn(), openSettings: vi.fn() }));
vi.mock('../src/js/signaturePlacement.js', () => ({ startPlacement: vi.fn() }));

const { initMessageDialog, showChoice } = await import('../src/js/messageDialog.js');
const { signPDF } = await import('../src/js/signature.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const button = (label) => [...document.querySelectorAll('#messageDialogFooter button')].find((b) => b.textContent === label);

describe('a prompt open when the certificate check answers', () => {
  it('keeps its own answer, and the next Sign asks to save and signs once', async () => {
    document.body.innerHTML = body;
    initMessageDialog();
    const tab = createPDFData(1, '/docs/a.pdf', 'doc1');
    tab.pdfDocument = { numPages: 2 };
    state.openPDFs.set(1, tab);
    state.activeTabId = 1;
    let settle;
    SignatureService.CheckCertificateRevocation.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
    SignatureService.ListCertificates.mockResolvedValue([{ fingerprint: 'a', name: 'A', issuer: 'I', validTo: '2030-01-01 00:00:00', isValid: true, canSign: true, requiresPin: false, pinOptional: false, source: 'User File' }]);
    SignatureService.ListSignatureProfiles.mockResolvedValue([{ id: 'inv', name: 'Invisible', visibility: 'invisible', isDefault: true }]);
    SignatureService.SignPDF.mockResolvedValue('/docs/a_signed.pdf');
    await signPDF();
    $('signSubmit').click();
    await vi.waitFor(() => expect($('signSubmit').getAttribute('aria-busy')).toBe('true'));

    // Edited, then the tab's close button asks about the changes.
    tab.dirty = true;
    let closeAnswer = 'pending';
    showChoice('If you don’t save, your changes will be lost.', 'Save changes to “a.pdf” before closing?', [
      { label: 'Don’t save', value: 'discard', danger: true, start: true }, { label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'save', primary: true }
    ]).then((answer) => { closeAnswer = answer; });

    settle({ status: 'good', check: '' });
    await vi.waitFor(() => expect($('signSubmit').getAttribute('aria-busy')).toBe('false'));
    expect($('messageDialogTitle').textContent).toContain('before closing');
    expect(closeAnswer).toBe('pending');
    button('Cancel').click();
    await vi.waitFor(() => expect(closeAnswer).toBe('cancel'));
    expect(saveTab).not.toHaveBeenCalled();
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();

    saveTab.mockImplementationOnce(async () => { tab.dirty = false; return true; });
    $('signSubmit').click();
    await vi.waitFor(() => expect(button('Save and Sign')).toBeTruthy());
    button('Save and Sign').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalledTimes(1));
    expect(saveTab).toHaveBeenCalledTimes(1);
  });
});
