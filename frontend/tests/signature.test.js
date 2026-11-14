import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, createPDFData } from '../src/js/state.js';
import { SignatureService, PDFService } from '../src/js/backend.js';

const openRecentFile = vi.fn(async () => 9);
const closeTab = vi.fn(async () => true);
// Like the real one, a save leaves the tab without unsaved edits.
const saveTab = vi.fn(async (id) => { const tab = state.openPDFs.get(id); if (tab) tab.dirty = false; return true; });
vi.mock('../src/js/documents.js', () => ({
  openRecentFile: (...a) => openRecentFile(...a),
  closeTab: (...a) => closeTab(...a),
  saveTab: (...a) => saveTab(...a),
  refreshDirty: (...a) => refreshDirty(...a)
}));
const refreshDirty = vi.fn((tab) => !!tab?.dirty);

const settings = {};
const setSetting = vi.fn((k, v) => { settings[k] = v; });
const openSettings = vi.fn();
vi.mock('../src/js/settings.js', () => ({
  getSetting: (k) => settings[k],
  setSetting: (...a) => setSetting(...a),
  openSettings: (...a) => openSettings(...a)
}));

// A fake live placement: the box stays on the page while the panel is open.
const POSITION = { page: 2, x: 10, y: 20, width: 200, height: 80 };
const placements = [];
const startPlacement = vi.fn((tab, profile, options) => {
  const placing = { tab, profile, options, stopped: false, position: vi.fn(() => POSITION), reveal: vi.fn(), setStamp: vi.fn(), stop: vi.fn(() => { placing.stopped = true; }) };
  placements.push(placing);
  options?.onChange?.(12);
  return placing;
});
vi.mock('../src/js/signaturePlacement.js', () => ({
  startPlacement: (...a) => startPlacement(...a)
}));

const showConfirm = vi.fn(async () => true);
const showChoice = vi.fn(async () => 'save');
vi.mock('../src/js/messageDialog.js', () => ({
  showMessage: vi.fn(async () => {}),
  showConfirm: (...a) => showConfirm(...a),
  showChoice: (...a) => showChoice(...a)
}));

const { signPDF, closeSignPanel, openSignedPDF, renderSignatureList, loadSignatureInfo, clearSignatureInfo } = await import('../src/js/signature.js');

const INVISIBLE = { id: 'inv', name: 'Invisible', visibility: 'invisible', isDefault: true };
const VISIBLE = { id: 'vis', name: 'Visible', visibility: 'visible', isDefault: false, appearance: { showSignerName: true, showLocation: true }, location: 'Girona' };

const cert = (fp, extra = {}) => ({
  fingerprint: fp, name: `Cert ${fp}`, issuer: 'Issuer', validTo: '2030-01-01 00:00:00',
  isValid: true, canSign: true, requiresPin: false, pinOptional: false, source: 'User File', ...extra
});

const $ = (sel) => document.querySelector(sel);
const panelOpen = () => !$('#signPanel').classList.contains('hidden');
const certOptions = () => [...document.querySelectorAll('#signCertMenu [role="menuitemradio"]')];
const certOption = (fp) => certOptions().find((o) => o.dataset.fingerprint === fp);
const chosenCert = () => certOptions().find((o) => o.getAttribute('aria-checked') === 'true')?.dataset.fingerprint;
const pickCert = (fp) => {
  $('#signCertButton').click();
  certOption(fp).click();
};
const pickProfile = (id) => {
  $('#signProfileSelect').value = id;
  $('#signProfileSelect').dispatchEvent(new Event('change'));
};
const activePlacements = () => placements.filter((p) => !p.stopped);

function openTab({ dirty = false } = {}) {
  const tab = createPDFData(1, '/docs/a.pdf', 'doc1');
  tab.pdfDocument = { numPages: 2 };
  tab.dirty = dirty;
  state.openPDFs.set(1, tab);
  state.activeTabId = 1;
  return tab;
}

async function openPanel(certs, profiles = [INVISIBLE, VISIBLE]) {
  SignatureService.ListCertificates.mockResolvedValue(certs);
  SignatureService.ListSignatureProfiles.mockResolvedValue(profiles);
  await signPDF();
}

beforeEach(() => {
  document.body.innerHTML = '<button id="signBtn"></button><main id="workspace"><aside id="signPanel" class="sign-dock hidden"></aside></main><div id="signatureInfo"></div><span id="statusText"></span>';
  closeSignPanel();
  state.openPDFs.clear();
  state.activeTabId = null;
  for (const k of Object.keys(settings)) delete settings[k];
  openRecentFile.mockClear();
  closeTab.mockReset().mockResolvedValue(true);
  startPlacement.mockClear();
  placements.length = 0;
  openTab();
});

describe('sign panel', () => {
  it('shows a single certificate that can sign as a summary instead of a picker', async () => {
    await openPanel([cert('a'), cert('expired', { isValid: false }), cert('nokey', { canSign: false })]);
    expect(panelOpen()).toBe(true);
    expect($('#signCertButton')).toBeNull();
    expect($('#signCertSummary').textContent).toContain('Cert a');
  });

  it('names the file being signed and where the signed copy goes', async () => {
    state.openPDFs.get(1).fileName = 'Master_Services-Agreement.pdf';
    await openPanel([cert('a')]);
    expect($('#signPanel').textContent).toContain('Master_Services-Agreement.pdf');
    const dest = $('#signDest');
    expect(dest.textContent).toBe('Master_Services-Agreement_signed.pdf');
    // One line that loses its middle: the end of the name and "_signed.pdf" stay, the full name is on hover.
    expect(dest.dataset.tip).toBe('Master_Services-Agreement_signed.pdf');
    expect(dest.querySelector('.path-tail').textContent).toBe('eement_signed.pdf');
    expect(dest.querySelectorAll('wbr')).toHaveLength(0);
  });

  it('keeps a quote in the file name inside the heading\'s tooltip', async () => {
    const fileName = 'a" onmouseover="alert(1).pdf';
    state.openPDFs.get(1).fileName = fileName;
    await openPanel([cert('a')]);
    const sub = $('#signPanel .dock-sub');
    expect(sub.hasAttribute('onmouseover')).toBe(false);
    expect(sub.getAttribute('title')).toBe(fileName);
  });

  it('marks the Sign button in the header pressed while the panel is open', async () => {
    await openPanel([cert('a')]);
    expect($('#signBtn').getAttribute('aria-pressed')).toBe('true');
    closeSignPanel();
    expect($('#signBtn').getAttribute('aria-pressed')).toBe('false');
  });

  it('preselects the last-used certificate among several', async () => {
    settings.lastCertificateFingerprint = 'b';
    await openPanel([cert('a'), cert('b')]);
    expect(chosenCert()).toBe('b');
    expect($('#signCertButton').textContent).toContain('Cert b');
  });

  it('falls back to the first certificate that can sign when the last-used one is gone', async () => {
    settings.lastCertificateFingerprint = 'gone';
    await openPanel([cert('x', { isValid: false }), cert('a'), cert('b')]);
    expect(chosenCert()).toBe('a');
  });

  it('lists certificates that cannot sign as disabled, with the reason', async () => {
    await openPanel([cert('old', { isValid: false, validTo: '2020-01-01 00:00:00' }), cert('a'), cert('nokey', { canSign: false }), cert('b')]);
    expect(certOption('a').disabled).toBe(false);
    expect(certOption('old').disabled).toBe(true);
    expect(certOption('old').querySelector('.option-meta').textContent).toMatch(/^Expired /);
    expect(certOption('nokey').disabled).toBe(true);
    expect(certOption('nokey').querySelector('.option-meta').textContent).toBe("Can't sign: no private key");
    // The ones that can sign come first.
    expect(certOptions().map((o) => o.dataset.fingerprint)).toEqual(['a', 'b', 'old', 'nokey']);
  });

  it('shows holder, source and expiry of the chosen certificate on two lines', async () => {
    await openPanel([
      cert('dnie', { name: 'GARCIA LOPEZ MARIA (FIRMA)', source: 'pkcs11', issuer: 'AC DNIE 004', validTo: '2029-03-02 09:00:00 +0000 UTC' }),
      cert('file:/home/u/maria.p12', { name: 'maria.p12', source: 'User File', issuer: '', validTo: '', requiresPin: true })
    ]);
    const button = $('#signCertButton');
    expect(button.querySelector('.option-title').textContent).toBe('GARCIA LOPEZ MARIA (FIRMA)');
    expect(button.querySelector('.option-meta').textContent).toMatch(/^DNIe · until .*2029/);
    expect(certOption('file:/home/u/maria.p12').querySelector('.option-meta').textContent).toMatch(/password-protected file/i);
  });

  it('lets the holder name break only at its " - " separators, never inside the ID', async () => {
    await openPanel([cert('dnie', { name: 'GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)' }), cert('b')]);
    const title = $('#signCertButton .option-title');
    expect(title.textContent).toBe('GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)');
    expect([...title.querySelectorAll('.name-part')].map((p) => p.textContent)).toEqual(['GARCIA LOPEZ MARIA -', 'DNI 12345678Z (FIRMA)']);
    expect(certOption('dnie').querySelectorAll('.option-title .name-part')).toHaveLength(2);
  });

  it('puts the full holder name in the certificate field tooltip', async () => {
    await openPanel([cert('dnie', { name: 'GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)' }), cert('b')]);
    expect($('#signCertButton').dataset.tip).toBe('GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)');
    pickCert('b');
    expect($('#signCertButton').dataset.tip).toBe('Cert b');
  });

  it('drops the " -" left dangling at the end of a line when the name breaks there', async () => {
    // Lay the parts out as the browser would in a field too narrow for one line.
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () {
      return this.textContent.startsWith('DNI') ? 16 : 0;
    });
    try {
      await openPanel([cert('dnie', { name: 'GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)' }), cert('b')]);
      const lineEnds = () => [...document.querySelectorAll('#signCertButton .name-part')].map((p) => p.classList.contains('is-line-end'));
      expect(lineEnds()).toEqual([true, false]);
      top.mockReturnValue(0);
      pickCert('dnie');
      expect(lineEnds()).toEqual([false, false]);
    } finally {
      top.mockRestore();
    }
  });

  it('warns about a certificate that expires within a month', async () => {
    const soon = new Date(Date.now() + 10 * 86400000);
    const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    await openPanel([cert('a', { validTo: `${ymd} 12:00:00` })]);
    const meta = $('#signCertSummary .option-meta');
    expect(meta.textContent).toBe('File · expires in 10 days');
    expect(meta.classList.contains('is-warning')).toBe(true);
  });

  it('preselects the last-used profile, else the default', async () => {
    await openPanel([cert('a')]);
    expect($('#signProfileSelect').value).toBe('inv');
    closeSignPanel();
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a')]);
    expect($('#signProfileSelect').value).toBe('vis');
  });

  it('shows an empty state that leads to certificate settings when nothing can sign', async () => {
    await openPanel([cert('x', { isValid: false })]);
    expect($('#signSubmit')).toBeNull();
    expect($('#signPanel').textContent).toMatch(/no signing certificate/i);
    $('#signOpenCertSettings').click();
    expect(openSettings).toHaveBeenCalledWith('certificates');
    expect(panelOpen()).toBe(false);
  });

  it('shows the PIN field only when the certificate uses one', async () => {
    await openPanel([cert('a', { requiresPin: true }), cert('b', { pinOptional: true }), cert('c')]);
    expect($('#signPinRow').hidden).toBe(false);
    expect($('#signPinLabel').textContent).not.toMatch(/optional/i);

    pickCert('b');
    expect(chosenCert()).toBe('b');
    expect($('#signPinRow').hidden).toBe(false);
    expect($('#signPinLabel').textContent).toMatch(/optional/i);

    pickCert('c');
    expect($('#signPinRow').hidden).toBe(true);
  });

  it('focuses the PIN field on open when the certificate needs one', async () => {
    await openPanel([cert('a', { requiresPin: true })]);
    expect(document.activeElement).toBe($('#signPinInput'));
  });

  it('shows and hides the PIN', async () => {
    await openPanel([cert('a', { requiresPin: true })]);
    const toggle = $('#signPinToggle');
    expect($('#signPinInput').type).toBe('password');
    toggle.click();
    expect($('#signPinInput').type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    expect($('#signPinInput').type).toBe('password');
  });

  it('asks for a required PIN before calling the backend', async () => {
    await openPanel([cert('a', { requiresPin: true })]);
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signPinError').textContent).toMatch(/PIN/));
    expect($('#signPinInput').getAttribute('aria-invalid')).toBe('true');
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  it('keeps the panel open after a wrong PIN, says so under the field, and signs on retry', async () => {
    await openPanel([cert('a', { requiresPin: true })]);
    SignatureService.SignPDF
      .mockRejectedValueOnce(new Error('cannot open me.p12: incorrect PIN or password'))
      .mockResolvedValueOnce('/docs/a_signed.pdf');

    $('#signPinInput').value = 'bad';
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signPinError').textContent).toMatch(/wrong PIN or password/i));
    expect(panelOpen()).toBe(true);
    expect($('#signPinInput').value).toBe('');
    expect(document.activeElement).toBe($('#signPinInput'));

    $('#signPinInput').value = 'good';
    $('#signPinInput').dispatchEvent(new Event('input'));
    expect($('#signPinError').textContent).toBe('');
    $('#signSubmit').click();
    await vi.waitFor(() => expect(openRecentFile).toHaveBeenCalledWith('/docs/a_signed.pdf'));
    expect(SignatureService.SignPDF).toHaveBeenLastCalledWith(expect.objectContaining({
      pdfPath: '/docs/a.pdf', outputPath: '', certFingerprint: 'a', pin: 'good', profileId: 'inv', position: null
    }));
    expect(panelOpen()).toBe(false);
    // Go saves the choice after signing; the panel only refreshes its copy.
    expect(settings).toMatchObject({ lastCertificateFingerprint: 'a', lastSignatureProfileId: 'inv' });
  });

  it('shows other errors inline and readable', async () => {
    await openPanel([cert('a')]);
    SignatureService.SignPDF.mockRejectedValueOnce(new Error('no token present: connect your smart card or token and try again'));
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signError').textContent).toContain('no token present'));
    expect(panelOpen()).toBe(true);
  });

  it('signs on Enter', async () => {
    await openPanel([cert('a')]);
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');
    $('#signProfileSelect').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalled());
  });

  it('draws the box of a visible profile on the page as soon as the panel opens', async () => {
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a')]);
    expect(startPlacement).toHaveBeenCalledWith(state.openPDFs.get(1), VISIBLE, expect.any(Object));
    expect(activePlacements()).toHaveLength(1);
    expect(activePlacements()[0].reveal).toHaveBeenCalled();
    // The panel is what the box must stay clear of.
    expect(activePlacements()[0].options.avoid()).toEqual($('#signPanel').getBoundingClientRect());
    expect($('#signProfileHint').textContent).toBe('Drag the box on page 12 to move it, or its corner to resize.');
  });

  it('shows in the box what the stamp will draw, with the chosen certificate as the signer', async () => {
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a'), cert('b')]);
    const [placing] = activePlacements();
    expect(placing.options.stamp.html).toContain('Cert a');
    expect(placing.options.stamp.html).toContain('Girona');

    pickCert('b');
    expect(placing.setStamp).toHaveBeenLastCalledWith(expect.objectContaining({ html: expect.stringContaining('Cert b') }));
  });

  it('draws no box for an invisible profile, and follows profile changes', async () => {
    await openPanel([cert('a')]);
    expect(startPlacement).not.toHaveBeenCalled();
    expect($('#signProfileHint').textContent).toMatch(/not drawn on the page/i);

    pickProfile('vis');
    expect(activePlacements()).toHaveLength(1);
    pickProfile('inv');
    expect(activePlacements()).toHaveLength(0);
  });

  it('signs a visible profile at the box on the page, without leaving the panel', async () => {
    settings.tsaUrl = 'http://tsa.test';
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a')]);
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');

    $('#signSubmit').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalled());
    expect(SignatureService.SignPDF).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'vis', position: POSITION, tsaUrl: 'http://tsa.test' }));
    await vi.waitFor(() => expect(panelOpen()).toBe(false));
    expect(activePlacements()).toHaveLength(0);
  });

  it('removes the box when the panel is cancelled', async () => {
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a')]);
    $('#signCancel').click();
    expect(panelOpen()).toBe(false);
    expect(activePlacements()).toHaveLength(0);
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  it('keeps the box where it is after a wrong PIN', async () => {
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a', { requiresPin: true })]);
    SignatureService.SignPDF.mockRejectedValueOnce(new Error('incorrect PIN or password'));
    $('#signPinInput').value = 'bad';
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signPinError').textContent).toMatch(/wrong/i));
    expect(startPlacement).toHaveBeenCalledTimes(1);
    expect(activePlacements()).toHaveLength(1);
  });

  it('closes when its tab is hidden or closed', async () => {
    settings.lastSignatureProfileId = 'vis';
    await openPanel([cert('a')]);
    state.openPDFs.get(1).cancelPlacement();
    expect(panelOpen()).toBe(false);
    expect(activePlacements()).toHaveLength(0);
    expect(state.openPDFs.get(1).cancelPlacement).toBeUndefined();
  });

  it('saves a signed copy where the user chooses, asking before replacing', async () => {
    await openPanel([cert('a')]);
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/out/copy.pdf', exists: true });
    SignatureService.SignPDF.mockResolvedValueOnce('/out/copy.pdf');
    $('#signSaveAs').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalled());
    expect(PDFService.ChooseSavePath).toHaveBeenCalledWith('doc1', 'a_signed.pdf');
    expect(showConfirm).toHaveBeenCalled();
    expect(SignatureService.SignPDF).toHaveBeenCalledWith(expect.objectContaining({ outputPath: '/out/copy.pdf' }));
  });

  it('saves a dirty tab first', async () => {
    state.openPDFs.get(1).dirty = true;
    await openPanel([cert('a')]);
    expect(saveTab).toHaveBeenCalledWith(1);
    expect(panelOpen()).toBe(true);
  });

  it('asks again to save edits made while the panel was open', async () => {
    await openPanel([cert('a')]);
    expect(showChoice).not.toHaveBeenCalled();
    state.openPDFs.get(1).dirty = true;
    showChoice.mockResolvedValueOnce('cancel');
    $('#signSubmit').click();
    await vi.waitFor(() => expect(showChoice).toHaveBeenCalled());
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect(panelOpen()).toBe(true);

    showChoice.mockResolvedValueOnce('save');
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');
    $('#signSubmit').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalled());
    expect(saveTab).toHaveBeenCalledWith(1);
  });

  it('cannot be closed while signing, and opens the result once done', async () => {
    await openPanel([cert('a')]);
    let finishSigning;
    SignatureService.SignPDF.mockReturnValueOnce(new Promise((resolve) => { finishSigning = resolve; }));
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signSubmit').textContent).toBe('Signing…'));

    expect($('#signSubmit').getAttribute('aria-busy')).toBe('true');
    expect($('#signCancel').disabled).toBe(true);
    expect($('#signCancelX').disabled).toBe(true);
    closeSignPanel();
    expect(panelOpen()).toBe(true);

    finishSigning('/docs/a_signed.pdf');
    await vi.waitFor(() => expect(openRecentFile).toHaveBeenCalledWith('/docs/a_signed.pdf'));
    expect(panelOpen()).toBe(false);
  });

  it('opens no second panel while one is open', async () => {
    await openPanel([cert('a')], [VISIBLE]);
    SignatureService.ListCertificates.mockClear();
    await signPDF();
    expect(SignatureService.ListCertificates).not.toHaveBeenCalled();
    expect(startPlacement).toHaveBeenCalledTimes(1);
  });

  it('stays closed when closed while loading, and opens again later', async () => {
    let finishLoading;
    SignatureService.ListCertificates.mockReturnValueOnce(new Promise((resolve) => { finishLoading = resolve; }));
    SignatureService.ListSignatureProfiles.mockResolvedValue([INVISIBLE]);
    const opening = signPDF();
    closeSignPanel();
    finishLoading([cert('a')]);
    await opening;
    expect(panelOpen()).toBe(false);

    await openPanel([cert('a')]);
    expect(panelOpen()).toBe(true);
    expect($('#signSubmit')).not.toBeNull();
  });

  it('offers certificates whose fingerprint holds a quote', async () => {
    const quoted = 'file:/home/u/my "work" key.p12';
    settings.lastCertificateFingerprint = quoted;
    await openPanel([cert('a'), cert(quoted)]);
    expect(chosenCert()).toBe(quoted);
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');
    $('#signSubmit').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalledWith(expect.objectContaining({ certFingerprint: quoted })));
  });

  it('re-checks for unsaved edits pdf.js did not report before signing the file on disk', async () => {
    refreshDirty.mockReturnValueOnce(true);
    await openPanel([cert('a')]);
    expect(showChoice).toHaveBeenCalled();
    expect(saveTab).toHaveBeenCalledWith(1);
  });

  it('opens no panel when its tab was left or closed while saving first', async () => {
    for (const leave of [() => { state.activeTabId = 2; }, (tab) => { tab.closed = true; }]) {
      openTab({ dirty: true });
      saveTab.mockImplementationOnce(async () => { leave(state.openPDFs.get(1)); return true; });
      await openPanel([cert('a')]);
      expect(saveTab).toHaveBeenCalled();
      expect(panelOpen()).toBe(false);
      expect(SignatureService.ListCertificates).not.toHaveBeenCalled();
      saveTab.mockClear();
    }
  });
});

describe('revocation of the chosen certificate', () => {
  const REVOKED = { status: 'revoked', check: 'OCSP checked online with the certificate authority', revokedAt: '2026-10-30T12:00:00Z' };
  const revokedDay = new Date(REVOKED.revokedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const notice = () => $('#signCertStatus .notice');
  const note = () => $('#signCertStatus .field-hint');
  const answer = (result) => SignatureService.CheckCertificateRevocation.mockResolvedValue(result);
  /** The next check waits until its returned function is called with the answer. */
  const pending = () => {
    let settle;
    SignatureService.CheckCertificateRevocation.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
    return (result) => settle(result);
  };

  beforeEach(() => {
    settings.checkRevocationOnline = true;
    SignatureService.CheckCertificateRevocation.mockReset();
  });

  it('warns about a revoked certificate and keeps it from signing', async () => {
    answer(REVOKED);
    await openPanel([cert('a'), cert('b')]);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(SignatureService.CheckCertificateRevocation).toHaveBeenCalledWith('a');
    expect(notice().classList.contains('danger')).toBe(true);
    expect(notice().textContent).toBe(`This certificate was revoked on ${revokedDay}. Signatures made with it can't be trusted.`);
    expect($('#signSubmit').disabled).toBe(true);
    expect($('#signSaveAs').disabled).toBe(true);

    $('#signProfileSelect').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  it('signs again once another certificate is chosen', async () => {
    SignatureService.CheckCertificateRevocation.mockImplementation(async (fp) => (fp === 'a' ? REVOKED : { status: 'good', check: '' }));
    await openPanel([cert('a'), cert('b')]);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    pickCert('b');
    await vi.waitFor(() => expect(SignatureService.CheckCertificateRevocation).toHaveBeenLastCalledWith('b'));
    expect($('#signCertStatus').textContent).toBe('');
    expect($('#signSubmit').disabled).toBe(false);
    expect($('#signSaveAs').disabled).toBe(false);
  });

  it('notes quietly when the check got no answer, and still signs', async () => {
    answer({ status: 'unavailable', check: "Couldn't reach the certificate authority's revocation service" });
    await openPanel([cert('a')]);
    await vi.waitFor(() => expect(note()).not.toBeNull());
    expect(note().textContent).toBe("Couldn't check whether this certificate was revoked.");
    expect(notice()).toBeNull();
    expect($('#signSubmit').disabled).toBe(false);
  });

  it('notes quietly when the check failed', async () => {
    SignatureService.CheckCertificateRevocation.mockRejectedValue(new Error('certificate not found'));
    await openPanel([cert('a')]);
    await vi.waitFor(() => expect(note()).not.toBeNull());
    expect($('#signSubmit').disabled).toBe(false);
  });

  it('says nothing for a good or unchecked certificate', async () => {
    for (const result of [{ status: 'good', check: '' }, { status: 'not_checked', check: "Not checked: the issuer isn't trusted" }, null]) {
      answer(result);
      await openPanel([cert('a')]);
      await vi.waitFor(() => expect(SignatureService.CheckCertificateRevocation).toHaveBeenCalled());
      await Promise.resolve();
      expect($('#signCertStatus').textContent).toBe('');
      expect($('#signSubmit').disabled).toBe(false);
      closeSignPanel();
      SignatureService.CheckCertificateRevocation.mockClear();
    }
  });

  it('asks nothing with online checks off', async () => {
    settings.checkRevocationOnline = false;
    await openPanel([cert('a'), cert('b')]);
    pickCert('b');
    expect(SignatureService.CheckCertificateRevocation).not.toHaveBeenCalled();
    expect($('#signCertStatus').textContent).toBe('');
  });

  it('drops the answer for a certificate no longer chosen', async () => {
    const settleA = pending();
    answer({ status: 'good', check: '' });
    await openPanel([cert('a'), cert('b')]);
    pickCert('b');
    await vi.waitFor(() => expect(SignatureService.CheckCertificateRevocation).toHaveBeenLastCalledWith('b'));
    settleA(REVOKED);
    await new Promise((resolve) => setTimeout(resolve));
    expect(notice()).toBeNull();
    expect($('#signSubmit').disabled).toBe(false);
  });

  it('keeps the latest answer when the same certificate is chosen again', async () => {
    const settleFirst = pending();
    answer(REVOKED);
    await openPanel([cert('a'), cert('b')]);
    pickCert('b');
    pickCert('a');
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    settleFirst({ status: 'unavailable', check: '' });
    await new Promise((resolve) => setTimeout(resolve));
    expect(notice()).not.toBeNull();
    expect($('#signSubmit').disabled).toBe(true);
  });

  it('drops the answer when the panel was closed, also once open again', async () => {
    const settleFirst = pending();
    await openPanel([cert('a')]);
    closeSignPanel();
    answer({ status: 'good', check: '' });
    await openPanel([cert('a')]);
    settleFirst(REVOKED);
    await new Promise((resolve) => setTimeout(resolve));
    expect(notice()).toBeNull();
    expect($('#signSubmit').disabled).toBe(false);
  });

  it('waits for the check before signing and does not sign with a certificate found revoked', async () => {
    const settle = pending();
    await openPanel([cert('a')]);
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('true'));
    expect($('#signSubmit').textContent).toBe('Checking certificate…');
    $('#signSubmit').click();
    settle(REVOKED);
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('false'));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect(notice()).not.toBeNull();
    expect($('#signSubmit').disabled).toBe(true);
    expect($('#signSaveAs').disabled).toBe(true);
  });

  it('does not save a copy signed with a certificate found revoked after the save dialog', async () => {
    const settle = pending();
    PDFService.ChooseSavePath.mockResolvedValueOnce({ path: '/out/copy.pdf', exists: false });
    await openPanel([cert('a')]);
    $('#signSaveAs').click();
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('true'));
    expect(PDFService.ChooseSavePath).toHaveBeenCalled();
    settle(REVOKED);
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('false'));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect(notice()).not.toBeNull();
  });

  it('does not sign when the revoked answer came while the save dialog was open', async () => {
    const settle = pending();
    let choose;
    PDFService.ChooseSavePath.mockReturnValueOnce(new Promise((resolve) => { choose = resolve; }));
    await openPanel([cert('a')]);
    $('#signSaveAs').click();
    settle(REVOKED);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    choose({ path: '/out/copy.pdf', exists: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect($('#signSubmit').disabled).toBe(true);
  });

  /** Clicks Sign with the check still pending; resolves once the panel shows it is checking. */
  const signWhileChecking = async () => {
    const settle = pending();
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');
    await openPanel([cert('a')]);
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('true'));
    return settle;
  };

  it('can be closed while checking, and then does not sign', async () => {
    const settle = await signWhileChecking();
    expect($('#signCancel').disabled).toBe(false);
    expect($('#signCancelX').disabled).toBe(false);
    $('#signCancel').click();
    expect(panelOpen()).toBe(false);
    settle({ status: 'good', check: '' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  it('closes on Esc while checking, and then does not sign', async () => {
    const settle = await signWhileChecking();
    closeSignPanel(); // what Esc calls
    expect(panelOpen()).toBe(false);
    settle({ status: 'good', check: '' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  it('closes when its tab is left while checking, and then does not sign', async () => {
    const settle = await signWhileChecking();
    state.openPDFs.get(1).cancelPlacement();
    expect(panelOpen()).toBe(false);
    settle({ status: 'good', check: '' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
  });

  const CHANGED = 'The document changed before signing started. Sign again to save and sign it.';

  it('stops without asking when the page was edited while checking, and asks on the next Sign', async () => {
    const settle = await signWhileChecking();
    const tab = state.openPDFs.get(1);
    tab.dirty = true;
    settle({ status: 'good', check: '' });
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('false'));
    expect(showChoice).not.toHaveBeenCalled();
    expect(saveTab).not.toHaveBeenCalled();
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect($('#signError').textContent).toBe(CHANGED);
    expect($('#signSubmit').disabled).toBe(false);

    showChoice.mockResolvedValueOnce('save');
    // The note was about the last attempt, not this one.
    let noteWhileSigning;
    // Drop the one-time result signWhileChecking queued for the attempt that stopped.
    SignatureService.SignPDF.mockReset().mockImplementationOnce(async () => {
      noteWhileSigning = $('#signError').textContent;
      return '/docs/a_signed.pdf';
    });
    $('#signSubmit').click();
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalledTimes(1));
    expect(showChoice).toHaveBeenCalledTimes(1);
    expect(saveTab).toHaveBeenCalledWith(1);
    expect(noteWhileSigning).toBe('');
  });

  it('neither asks nor signs when the certificate was found revoked and the page edited while checking', async () => {
    const settle = await signWhileChecking();
    state.openPDFs.get(1).dirty = true;
    settle(REVOKED);
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('false'));
    expect(showChoice).not.toHaveBeenCalled();
    expect(saveTab).not.toHaveBeenCalled();
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    expect(notice()).not.toBeNull();
    expect($('#signSubmit').disabled).toBe(true);
  });

  it('signs once the pending check finds the certificate good', async () => {
    const settle = pending();
    SignatureService.SignPDF.mockResolvedValueOnce('/docs/a_signed.pdf');
    await openPanel([cert('a')]);
    $('#signSubmit').click();
    await vi.waitFor(() => expect($('#signSubmit').getAttribute('aria-busy')).toBe('true'));
    $('#signSubmit').click();
    $('#signProfileSelect').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(SignatureService.SignPDF).not.toHaveBeenCalled();
    settle({ status: 'good', check: '' });
    await vi.waitFor(() => expect(SignatureService.SignPDF).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(SignatureService.SignPDF).toHaveBeenCalledTimes(1);
  });
});

describe('signatures panel', () => {
  it('says when there are no signatures', async () => {
    SignatureService.VerifySignatures.mockResolvedValueOnce([]);
    await loadSignatureInfo('/docs/a.pdf');
    expect($('#signatureInfo').textContent).toContain('No signatures');
  });

  it('marks the Info segment while a signature needs attention', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button class="tab-btn" data-tab="signatures">Info</button>');
    const info = $('.tab-btn[data-tab="signatures"]');
    SignatureService.VerifySignatures.mockResolvedValueOnce([{ signerName: 'Bob', isValid: true, certificateValid: false }]);
    await loadSignatureInfo('/docs/a.pdf');
    expect(info.dataset.attention).toBe('warning');
    SignatureService.VerifySignatures.mockResolvedValueOnce([{ signerName: 'Eve', isValid: false, certificateValid: false }]);
    await loadSignatureInfo('/docs/a.pdf');
    expect(info.dataset.attention).toBe('danger');
    SignatureService.VerifySignatures.mockResolvedValueOnce([{ signerName: 'Alice', isValid: true, certificateValid: true, revocationStatus: 'good' }]);
    await loadSignatureInfo('/docs/a.pdf');
    expect(info.dataset.attention).toBeUndefined();
  });

  it('keeps the shown document\'s signatures when a slower online check of another finishes later', async () => {
    let finishSlow;
    SignatureService.VerifySignatures.mockImplementationOnce(() => new Promise((resolve) => { finishSlow = resolve; }));
    const slow = loadSignatureInfo('/docs/slow.pdf');
    expect($('#signatureInfo').textContent).toContain('Checking signatures');
    SignatureService.VerifySignatures.mockResolvedValueOnce([{ signerName: 'Alice', isValid: true, certificateValid: true }]);
    await loadSignatureInfo('/docs/a.pdf');
    finishSlow([{ signerName: 'Mallory', isValid: false, certificateValid: false }]);
    await slow;
    expect($('#signatureInfo').textContent).toContain('Alice');
    expect($('#signatureInfo').textContent).not.toContain('Mallory');
  });

  it('clears the signatures and the attention mark, and drops a check still running', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button class="tab-btn" data-tab="signatures">Info</button>');
    SignatureService.VerifySignatures.mockResolvedValueOnce([{ signerName: 'Eve', isValid: false }]);
    await loadSignatureInfo('/docs/a.pdf');
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBe('danger');
    let finishSlow;
    SignatureService.VerifySignatures.mockImplementationOnce(() => new Promise((resolve) => { finishSlow = resolve; }));
    const slow = loadSignatureInfo('/docs/a.pdf');

    clearSignatureInfo();
    expect($('#signatureInfo').textContent).toBe('');
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBeUndefined();
    finishSlow([{ signerName: 'Mallory', isValid: false }]);
    await slow;
    expect($('#signatureInfo').textContent).toBe('');
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBeUndefined();
  });

  it('shows signer, time, validity and trust with an explanation', () => {
    const html = renderSignatureList([
      { signerName: 'Alice', signingTime: '2026-11-13T10:00:00Z', isValid: true, certificateValid: true, revocationStatus: 'good', certificateValidationMessage: 'Certificate is valid and trusted' },
      { signerName: 'Bob', signingTime: '2026-11-13T11:00:00Z', isValid: true, certificateValid: false, certificateValidationMessage: 'not in system trust store' },
      { signerName: '<Eve>', isValid: false, certificateValid: false, validationMessage: 'Signature validation failed: digest mismatch' }
    ]);
    const div = document.createElement('div');
    div.innerHTML = html;
    const items = div.querySelectorAll('.signature-item');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Alice');
    expect(items[0].textContent).toMatch(/Valid/);
    expect(items[0].textContent).toMatch(/trusted/i);
    expect(items[1].textContent).toMatch(/not trusted/i);
    expect(items[2].textContent).toMatch(/Invalid/);
    expect(items[2].textContent).toContain('digest mismatch');
    expect(items[2].textContent).toContain('<Eve>');
  });
});

describe('signature card', () => {
  const card = (sig) => {
    const div = document.createElement('div');
    div.innerHTML = renderSignatureList([sig]);
    return div.querySelector('.signature-item');
  };

  it('explains in plain words and keeps the technical reason under See more', () => {
    const item = card({ signerName: 'Bob', isValid: true, certificateValid: false, certificateValidationMessage: 'not in system trust store' });
    expect(item.querySelector('.signature-explain').textContent).toMatch(/identity is not confirmed/);
    expect(item.querySelector('.signature-explain').textContent).not.toContain('trust store');
    expect(item.querySelector('details')).toBeNull();
    const more = item.querySelector('.signature-more');
    expect(more.hidden).toBe(true);
    expect(more.textContent).toContain('not in system trust store');
  });
  it('puts each fact under its label', () => {
    const item = card({ signerName: 'Alice', signingTime: '2026-11-13T10:00:00Z', reason: 'I approve', location: 'Barcelona', isValid: true, certificateValid: true });
    const facts = [...item.querySelectorAll(':scope > .facts > .fact')].map((f) => [f.querySelector('dt').textContent, f.querySelector('dd').textContent]);
    expect(facts.map(([label]) => label)).toEqual(['Signed', 'Reason', 'Location']);
    expect(facts[2][1]).toBe('Barcelona');
  });
});

describe('signature details', () => {
  const DNIE = {
    signerName: 'GARCIA LOPEZ MARIA - 12345678Z',
    signerDN: 'CN=GARCIA LOPEZ MARIA - 12345678Z,SERIALNUMBER=IDCES-12345678Z,C=ES',
    signingTime: '2026-11-09T11:32:00Z',
    signingTimeSource: 'signer',
    signatureType: 'SHA256-RSA',
    keyAlgorithm: 'RSA 2048',
    issuerName: 'AC FNMT Usuarios',
    issuerDN: 'CN=AC FNMT Usuarios,OU=Ceres,O=FNMT-RCM,C=ES',
    certificateSerial: '4C:1F:0A:9B',
    certificateValidFrom: '2024-03-01T09:00:00Z',
    certificateValidUntil: '2025-03-01T09:00:00Z',
    timestampStatus: 'none',
    timestampTime: '',
    revocationStatus: 'not_checked',
    revocationCheck: 'Not checked',
    chain: [
      { subject: 'GARCIA LOPEZ MARIA - 12345678Z', issuer: 'AC FNMT Usuarios' },
      { subject: 'AC FNMT Usuarios', issuer: 'AC RAIZ FNMT-RCM' },
      { subject: 'AC RAIZ FNMT-RCM', issuer: 'AC RAIZ FNMT-RCM' }
    ],
    warnings: ['Timestamp certificate chain validation failed'],
    contactInfo: 'maria@example.es',
    isValid: true,
    certificateValid: false,
    validationMessage: 'Signature is cryptographically valid',
    certificateValidationMessage: 'Certificate chain validation issue (not in system trust store)'
  };

  const show = async (sigs = [DNIE], path = '/docs/a.pdf') => {
    SignatureService.VerifySignatures.mockResolvedValueOnce(sigs);
    await loadSignatureInfo(path);
    return $('#signatureInfo .signature-item');
  };
  const toggle = (item) => item.querySelector('.signature-more-btn');
  const group = (item, title) => [...item.querySelectorAll('.signature-more-group')]
    .find((g) => g.querySelector('.signature-more-title').textContent === title);
  const facts = (el) => Object.fromEntries([...el.querySelectorAll('.fact')].map((f) => [f.querySelector('dt').textContent.trim(), f.querySelector('dd')]));

  it('opens and closes behind a See more button', async () => {
    const item = await show();
    const button = toggle(item);
    const more = document.getElementById(button.getAttribute('aria-controls'));
    expect(more).toBe(item.querySelector('.signature-more'));
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent.trim()).toBe('See more');
    expect(more.hidden).toBe(true);

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent.trim()).toBe('See less');
    expect(more.hidden).toBe(false);

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(more.hidden).toBe(true);
  });

  it('groups the signature, its certificate, the chain and the checks', async () => {
    const item = await show();
    const titles = [...item.querySelectorAll('.signature-more-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Signature', 'Signer certificate', 'Certificate chain', 'Checks']);

    const signature = facts(group(item, 'Signature'));
    expect(signature['Time source'].textContent).toMatch(/signer's computer, not verified/i);
    expect(signature.Timestamp.textContent).toBe('None');
    expect(signature.Contact.textContent).toBe('maria@example.es');

    const cert = facts(group(item, 'Signer certificate'));
    expect(cert.Subject.querySelector('code').textContent).toContain('SERIALNUMBER=IDCES-12345678Z');
    expect(cert.Subject.closest('.fact').querySelector('[data-copy]').dataset.copy).toBe(DNIE.signerDN);
    expect(cert.Issuer.textContent).toContain('AC FNMT Usuarios');
    expect(cert.Serial.querySelector('code').textContent).toBe('4C:1F:0A:9B');
    expect(cert.Serial.closest('.fact').querySelector('[data-copy]').dataset.copy).toBe('4C:1F:0A:9B');
    expect(cert.Valid.textContent).toMatch(/2024.*2025/);
    expect(cert.Valid.querySelector('.pill').textContent).toBe('Expired');
    expect(cert.Key.textContent).toBe('RSA 2048');
    expect(cert['Signature algorithm'].textContent).toBe('SHA256-RSA');
  });

  it('shows no digest, which pdfsign never reports', async () => {
    const item = await show([{ ...DNIE, signingHashAlgorithm: 'SHA-256' }]);
    expect(Object.keys(facts(group(item, 'Signature')))).toEqual(['Time source', 'Timestamp', 'Contact']);
  });

  it('lists the chain from the signer to an untrusted root', async () => {
    const item = await show();
    const nodes = [...group(item, 'Certificate chain').querySelectorAll('li')];
    expect(nodes.map((n) => n.querySelector('.signature-chain-name').textContent))
      .toEqual(['GARCIA LOPEZ MARIA - 12345678Z', 'AC FNMT Usuarios', 'AC RAIZ FNMT-RCM']);
    expect(nodes[0].textContent).toContain('Signer');
    expect(nodes[2].classList.contains('warning')).toBe(true);
    expect(nodes[2].textContent).toMatch(/not trusted/i);
  });

  it('ends the chain at an issuer the PDF does not include', async () => {
    const item = await show([{ ...DNIE, chain: [DNIE.chain[0]] }]);
    const nodes = [...group(item, 'Certificate chain').querySelectorAll('li')];
    expect(nodes.map((n) => n.querySelector('.signature-chain-name').textContent))
      .toEqual(['GARCIA LOPEZ MARIA - 12345678Z', 'AC FNMT Usuarios']);
    expect(nodes[1].textContent).toMatch(/not in the PDF/i);
  });

  it('shows each check with an icon and words, warnings included', async () => {
    const item = await show();
    const checks = [...group(item, 'Checks').querySelectorAll('li')];
    const text = checks.map((c) => c.textContent);
    expect(checks.map((c) => c.dataset.tone)).toEqual(['success', 'warning', 'warning', 'warning']);
    checks.forEach((c) => expect(c.querySelector('svg')).not.toBeNull());
    expect(text[0]).toMatch(/unchanged/i);
    expect(text[1]).toContain('not in system trust store');
    expect(text[2]).toMatch(/revocation not checked/i);
    expect(text[3]).toContain('Timestamp certificate chain validation failed');
  });

  it('marks a damaged signature and a revoked certificate as danger', async () => {
    const item = await show([{
      ...DNIE, isValid: false, validationMessage: 'Signature validation failed: digest mismatch',
      certificateValidationMessage: 'Certificate has been revoked on 2026-10-30 12:00:00',
      revocationStatus: 'revoked', revocationCheck: 'CRL checked online', warnings: []
    }]);
    const checks = [...group(item, 'Checks').querySelectorAll('li')];
    expect(checks[0].dataset.tone).toBe('danger');
    expect(checks[0].textContent).toContain('digest mismatch');
    expect(checks[1].textContent).not.toContain('revoked');
    expect(checks[2].dataset.tone).toBe('danger');
    expect(checks[2].textContent).toContain('revoked on 2026-10-30');
    expect(checks[2].textContent).toContain('CRL checked online');

    const nodes = [...group(item, 'Certificate chain').querySelectorAll('li')];
    expect(nodes[0].classList.contains('danger')).toBe(true);
    expect(nodes[0].textContent).toMatch(/revoked/i);
    expect(nodes[2].textContent).not.toMatch(/revoked/i);
  });

  it('says how revocation was checked online, or why it was not', async () => {
    const revocationRow = async (revocationStatus, revocationCheck) => {
      const item = await show([{ ...DNIE, revocationStatus, revocationCheck, warnings: [] }]);
      const row = [...group(item, 'Checks').querySelectorAll('li')][2];
      return {
        tone: row.dataset.tone,
        icon: row.querySelector('svg') !== null,
        title: row.querySelector('.signature-check-title').textContent,
        details: [...row.querySelectorAll('.signature-check-detail')].map((d) => d.textContent)
      };
    };
    expect(await revocationRow('good', 'OCSP checked online with the certificate authority')).toEqual({
      tone: 'success', icon: true, title: 'Not revoked', details: ['OCSP checked online with the certificate authority']
    });
    expect(await revocationRow('good', 'Embedded in the PDF')).toMatchObject({ tone: 'success', details: ['Embedded in the PDF'] });
    expect(await revocationRow('unavailable', "Couldn't reach the certificate authority's revocation service")).toEqual({
      tone: 'warning', icon: true, title: "Couldn't check revocation", details: ["Couldn't reach the certificate authority's revocation service"]
    });
    expect(await revocationRow('not_checked', 'Not checked (turned off in settings)')).toEqual({
      tone: 'warning', icon: true, title: 'Revocation not checked', details: ['Turned off in settings']
    });
    expect(await revocationRow('not_checked', "Not checked: the issuer isn't trusted")).toMatchObject({ details: ["The issuer isn't trusted"] });
    expect(await revocationRow('not_checked', 'The certificate names no revocation service')).toMatchObject({
      tone: 'warning', details: ['The certificate names no revocation service']
    });
    expect(await revocationRow('not_checked', 'Not checked')).toMatchObject({ details: [] });
  });

  it('says a revoked certificate in the status line and marks the Info segment', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button class="tab-btn" data-tab="signatures">Info</button>');
    const item = await show([{
      ...DNIE, issuerTrusted: true, certificateValid: false, revocationStatus: 'revoked',
      revocationCheck: 'OCSP checked online with the certificate authority',
      certificateValidationMessage: 'Certificate has been revoked on 2023-06-08 18:14:36 (revoked before signing)'
    }]);
    const status = item.querySelector('.signature-status');
    expect(status.classList.contains('invalid')).toBe(true);
    expect(status.textContent).toBe('Certificate revoked');
    expect(item.querySelector('.signature-explain').textContent).toMatch(/certificate was revoked/);
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBe('danger');
  });

  it('checks the open document again when online revocation checking is switched', async () => {
    openTab();
    settings.checkRevocationOnline = true;
    document.dispatchEvent(new CustomEvent('settings-applied'));
    await Promise.resolve();
    SignatureService.VerifySignatures.mockClear();

    document.dispatchEvent(new CustomEvent('settings-applied'));
    await Promise.resolve();
    expect(SignatureService.VerifySignatures).not.toHaveBeenCalled();

    SignatureService.VerifySignatures.mockResolvedValueOnce([DNIE]);
    settings.checkRevocationOnline = false;
    document.dispatchEvent(new CustomEvent('settings-applied'));
    await vi.waitFor(() => expect(SignatureService.VerifySignatures).toHaveBeenCalledWith('/docs/a.pdf'));
  });

  it('does not call a certificate trusted when its revocation could not be checked', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button class="tab-btn" data-tab="signatures">Info</button>');
    const item = await show([{
      ...DNIE, issuerTrusted: true, certificateValid: true, revocationStatus: 'unavailable',
      revocationCheck: "Couldn't reach the certificate authority's revocation service"
    }]);
    const status = item.querySelector('.signature-status');
    expect(status.classList.contains('untrusted')).toBe(true);
    expect(status.textContent).toBe("Valid, revocation couldn't be checked");
    expect(item.querySelector('.signature-explain').textContent).toMatch(/couldn't confirm .* not revoked/);
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBe('warning');
  });

  it('says a certificate revoked after a trusted signing time as a warning, not as revoked', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button class="tab-btn" data-tab="signatures">Info</button>');
    const item = await show([{
      ...DNIE, issuerTrusted: true, certificateValid: true, revocationStatus: 'revoked_later',
      revocationCheck: 'Revoked on 30 Oct 2026, after the trusted signing time', warnings: []
    }]);
    const status = item.querySelector('.signature-status');
    expect(status.classList.contains('untrusted')).toBe(true);
    expect(status.textContent).toBe('Valid, certificate revoked after signing');
    expect(item.querySelector('.signature-explain').textContent).toMatch(/signed before .* revoked/);
    const row = [...group(item, 'Checks').querySelectorAll('li')][2];
    expect(row.dataset.tone).toBe('warning');
    expect(row.querySelector('.signature-check-title').textContent).toBe('Certificate revoked after signing');
    expect(row.textContent).toContain('Revoked on 30 Oct 2026, after the trusted signing time');
    expect($('.tab-btn[data-tab="signatures"]').dataset.attention).toBe('warning');
  });

  it('claims a revocation after a trusted signing time only for a trusted certificate', async () => {
    const item = await show([{ ...DNIE, issuerTrusted: false, certificateValid: false, revocationStatus: 'revoked_later', revocationCheck: 'Revoked on 30 Oct 2026, after the trusted signing time', warnings: [] }]);
    expect(item.querySelector('.signature-status').textContent).toBe('Valid, certificate not trusted');
    expect(item.querySelector('.signature-explain').textContent).not.toMatch(/timestamp/);
    const row = [...group(item, 'Checks').querySelectorAll('li')][2];
    expect(row.querySelector('.signature-check-title').textContent).toBe('Revocation not checked');
    expect(row.textContent).not.toMatch(/signing time/);
  });

  it('calls a trusted certificate green only once it is known not to be revoked', async () => {
    const headline = async (revocationStatus, revocationCheck) => {
      const item = await show([{ ...DNIE, issuerTrusted: true, certificateValid: true, revocationStatus, revocationCheck, warnings: [] }]);
      const status = item.querySelector('.signature-status');
      return [status.classList.contains('valid') ? 'valid' : 'untrusted', status.textContent, item.querySelector('.signature-explain').textContent];
    };
    expect(await headline('good', 'OCSP checked online with the certificate authority')).toEqual(
      ['valid', 'Valid, certificate trusted', 'The document is unchanged since it was signed, and the signer\'s certificate is trusted.']);
    const [tone, text, explanation] = await headline('not_checked', 'Not checked (turned off in settings)');
    expect([tone, text]).toEqual(['untrusted', 'Valid, revocation not checked']);
    expect(explanation).toMatch(/online checks are off in Settings/);
    expect((await headline('not_checked', "Revocation data in the PDF couldn't be verified")).slice(0, 2))
      .toEqual(['untrusted', "Valid, revocation couldn't be checked"]);
    expect((await headline('not_checked', 'The certificate names no revocation service')).slice(0, 2))
      .toEqual(['untrusted', "Valid, revocation couldn't be checked"]);
  });

  it('marks a trusted root as trusted, even when the signer is revoked', async () => {
    const item = await show([{ ...DNIE, issuerTrusted: true, revocationStatus: 'revoked' }]);
    const nodes = [...group(item, 'Certificate chain').querySelectorAll('li')];
    expect(nodes[2].classList.contains('success')).toBe(true);
    expect(nodes[2].textContent).toMatch(/Root, trusted/);
    const checks = [...group(item, 'Checks').querySelectorAll('li')];
    expect(checks[1].dataset.tone).toBe('success');
    // The trust row is about who issued it, so it doesn't contradict the revoked row below.
    expect(checks[1].textContent).toBe('Issued by a trusted authority');
  });

  it('names surname and given name in a certificate subject instead of their codes', async () => {
    const item = await show([{ ...DNIE, signerDN: 'SERIALNUMBER=IDCES-53295545Z,CN=MATEU BERGA FERRAN - 53295545Z,C=ES,2.5.4.4=MATEU BERGA,2.5.4.42=FERRAN' }]);
    const subject = facts(group(item, 'Signer certificate')).Subject.textContent;
    expect(subject).toContain('SN=MATEU BERGA');
    expect(subject).toContain('GN=FERRAN');
    expect(subject).not.toContain('2.5.4.');
  });

  it('says a trusted timestamp gave the signing time', async () => {
    const item = await show([{ ...DNIE, signingTimeSource: 'timestamp', timestampStatus: 'valid', timestampTime: '2026-11-09T11:32:05Z' }]);
    const signature = facts(group(item, 'Signature'));
    expect(signature['Time source'].textContent).toMatch(/trusted timestamp/i);
    expect(signature.Timestamp.textContent).toMatch(/trusted/i);
    expect(signature.Timestamp.textContent).toMatch(/2026/);
  });

  it('stays open while the document stays open, not for another document', async () => {
    let item = await show();
    toggle(item).click();
    item = await show();
    expect(toggle(item).getAttribute('aria-expanded')).toBe('true');
    expect(item.querySelector('.signature-more').hidden).toBe(false);

    state.openPDFs.set(2, createPDFData(2, '/docs/b.pdf', 'doc2'));
    item = await show([DNIE], '/docs/b.pdf');
    expect(toggle(item).getAttribute('aria-expanded')).toBe('false');

    state.openPDFs.delete(1);
    state.openPDFs.set(1, createPDFData(1, '/docs/a.pdf', 'doc1'));
    item = await show();
    expect(toggle(item).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('openSignedPDF', () => {
  it('opens the signed file in a tab', async () => {
    await openSignedPDF('/docs/a_signed.pdf');
    expect(closeTab).not.toHaveBeenCalled();
    expect(openRecentFile).toHaveBeenCalledWith('/docs/a_signed.pdf');
  });

  it('replaces a tab that still shows the overwritten file', async () => {
    state.openPDFs.set(4, createPDFData(4, '/docs/a_signed.pdf', 'old'));
    await openSignedPDF('/docs/a_signed.pdf');
    expect(closeTab).toHaveBeenCalledWith(4);
    expect(openRecentFile).toHaveBeenCalledWith('/docs/a_signed.pdf');
  });

  it('leaves the old tab alone when the user keeps its unsaved edits', async () => {
    state.openPDFs.set(4, createPDFData(4, '/docs/a_signed.pdf', 'old'));
    closeTab.mockResolvedValueOnce(false);
    await openSignedPDF('/docs/a_signed.pdf');
    expect(openRecentFile).not.toHaveBeenCalled();
  });
});
