import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { App, ConfigService, SignatureService } from '../src/js/backend.js';

vi.mock('../src/js/messageDialog.js', () => ({
  showMessage: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => true)
}));

const { initSettings, openSettings, getSetting } = await import('../src/js/settings.js');
const { showMessage } = await import('../src/js/messageDialog.js');
const { formatDate, renderCertificateItem } = await import('../src/js/certificateRenderer.js');
const { SETTINGS } = await import('../src/js/constants.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const shown = (id) => !$(id).classList.contains('hidden');
const press = (key, mods = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
const keycapText = (el) => [...el.querySelectorAll('kbd')].map((k) => k.textContent).join(' ');

beforeEach(async () => {
  document.body.innerHTML = body;
  localStorage.clear();
  ConfigService.Get.mockResolvedValue({
    theme: 'dark',
    certificateStores: ['/home/ana/.pki/certs'],
    tokenLibraries: ['/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so']
  });
  ConfigService.Update.mockResolvedValue();
  SignatureService.ListCertificates.mockResolvedValue([]);
  SignatureService.ListSignatureProfiles.mockResolvedValue([]);
  SignatureService.SaveSignatureProfile.mockResolvedValue();
  App.Version.mockResolvedValue('1.2.3-test');
  await initSettings();
});

describe('settings dialog', () => {
  it('closes after a successful save', async () => {
    openSettings();
    expect(shown('settingsModal')).toBe(true);
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalled());
    await vi.waitFor(() => expect(shown('settingsModal')).toBe(false));
  });

  it('checks revocation online unless turned off, and saves the switch', async () => {
    openSettings('signatures');
    expect($('settingCheckRevocationOnline').checked).toBe(true);
    expect($('settingCheckRevocationOnline').closest('.pref-row').textContent).toMatch(/network connection/);
    $('settingCheckRevocationOnline').click();
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalledWith(expect.objectContaining({ checkRevocationOnline: false })));
    expect(getSetting('checkRevocationOnline')).toBe(false);
    openSettings('signatures');
    expect($('settingCheckRevocationOnline').checked).toBe(false);
  });

  it('has no Auto-save setting, and saving keeps the stored autosaveInterval', async () => {
    ConfigService.Get.mockResolvedValue({ theme: 'dark', autosaveInterval: 30 });
    await initSettings();
    openSettings('files');
    expect($('settingAutosaveInterval')).toBeNull();
    expect($('filesSection').textContent).not.toMatch(/auto-save/i);
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalledWith(expect.objectContaining({ autosaveInterval: 30 })));
  });

  it('says Hardware acceleration applies after a restart, and saves the switch', async () => {
    openSettings('advanced');
    expect($('settingHardwareAccel').checked).toBe(true);
    expect($('settingHardwareAccel').closest('.pref-row').textContent).toMatch(/restart/i);
    $('settingHardwareAccel').click();
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalledWith(expect.objectContaining({ hardwareAccel: false })));
  });

  it('offers default zoom from 10 to 400% and 1 to 50 recent files, the limits the CLI keeps too', () => {
    expect([$('settingDefaultZoom').min, $('settingDefaultZoom').max]).toEqual([String(SETTINGS.ZOOM.MIN), String(SETTINGS.ZOOM.MAX)]);
    expect([SETTINGS.ZOOM.MIN, SETTINGS.ZOOM.MAX]).toEqual([10, 400]);
    expect([$('settingRecentFilesLength').min, $('settingRecentFilesLength').max]).toEqual([String(SETTINGS.RECENT_FILES.MIN), String(SETTINGS.RECENT_FILES.MAX)]);
    expect([SETTINGS.RECENT_FILES.MIN, SETTINGS.RECENT_FILES.MAX]).toEqual([1, 50]);
    expect($('settingDefaultZoom').closest('.pref-row').textContent).toMatch(/from 10 to 400%/);
    expect($('settingRecentFilesLength').closest('.pref-row').textContent).toMatch(/up to 50/);
  });

  it('saves zoom and recent files within the limits, and brings a changed value outside them to the nearest limit', async () => {
    const save = async (zoom, recent) => {
      openSettings('viewer');
      $('settingDefaultZoom').value = zoom;
      $('settingRecentFilesLength').value = recent;
      ConfigService.Update.mockClear();
      $('settingsSave').click();
      await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalled());
      await vi.waitFor(() => expect(shown('settingsModal')).toBe(false));
      return [getSetting('defaultZoom'), getSetting('recentFilesLength')];
    };
    expect(await save('200', '20')).toEqual([200, 20]);
    expect(await save('450', '0')).toEqual([400, 1]);
    expect(await save('5', '80')).toEqual([10, 50]);
    // A number field accepts exponents; 1e3 is a thousand, not 1.
    expect(await save('1e3', '1e2')).toEqual([400, 50]);
  });

  it('keeps an older file\'s values outside the limits when saved untouched', async () => {
    ConfigService.Get.mockResolvedValue({ theme: 'dark', defaultZoom: 500, recentFilesLength: 0 });
    await initSettings();
    openSettings('viewer');
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalledWith(expect.objectContaining({ defaultZoom: 500, recentFilesLength: 0 })));
  });

  it('brings an older file\'s value outside the limits to the nearest one once it is changed', async () => {
    ConfigService.Get.mockResolvedValue({ theme: 'dark', defaultZoom: 500, recentFilesLength: 0 });
    await initSettings();
    openSettings('viewer');
    $('settingDefaultZoom').value = '450';
    $('settingsSave').click();
    await vi.waitFor(() => expect(ConfigService.Update).toHaveBeenCalledWith(expect.objectContaining({ defaultZoom: 400, recentFilesLength: 0 })));
  });

  it('shows the app version under Advanced', async () => {
    openSettings('advanced');
    expect($('settingAppVersion').textContent).toBe('1.2.3-test');
  });

  it('names the open section in its header', () => {
    openSettings('certificates');
    expect($('settingsPageTitle').textContent).toBe('Certificates');
    document.querySelector('.settings-tab[data-section="shortcuts"]').click();
    expect($('settingsPageTitle').textContent).toBe('Shortcuts');
  });
});

describe('shortcut capture', () => {
  it('shows the current binding as keycaps and saves a new one', async () => {
    openSettings('shortcuts');
    expect(keycapText($('settingShortcutOpenFile'))).toBe('Ctrl O');
    $('settingShortcutOpenFile').click();
    expect(shown('shortcutCaptureModal')).toBe(true);
    expect(keycapText($('shortcutCaptureDisplay'))).toBe('Ctrl O');

    press('p', { ctrlKey: true });
    expect(keycapText($('shortcutCaptureDisplay'))).toBe('Ctrl P');
    expect($('shortcutCaptureOk').disabled).toBe(false);
    $('shortcutCaptureOk').click();
    expect(shown('shortcutCaptureModal')).toBe(false);
    expect(keycapText($('settingShortcutOpenFile'))).toBe('Ctrl P');

    $('settingsSave').click();
    await vi.waitFor(() => expect(getSetting('shortcuts').openFile).toBe('Control+p'));
  });

  it('warns about a shortcut another action uses and will not save it', () => {
    openSettings('shortcuts');
    $('settingShortcutOpenFile').click();
    press('s', { altKey: true });
    expect($('shortcutCaptureStatus').textContent).toMatch(/Sign document/);
    expect($('shortcutCaptureOk').disabled).toBe(true);
  });

  it('leaves Enter and Space to a focused button in the dialog', () => {
    openSettings('shortcuts');
    $('settingShortcutOpenFile').click();
    press('p', { ctrlKey: true });
    $('shortcutCaptureCancel').focus();
    for (const key of ['Enter', ' ']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      $('shortcutCaptureCancel').dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(keycapText($('shortcutCaptureDisplay'))).toBe('Ctrl P');
    expect(keycapText($('settingShortcutOpenFile'))).toBe('Ctrl O');
  });

  it('warns about a shortcut the app reserves', () => {
    openSettings('shortcuts');
    $('settingShortcutSign').click();
    press('s', { ctrlKey: true });
    expect($('shortcutCaptureStatus').textContent).toMatch(/Save/);
    expect($('shortcutCaptureOk').disabled).toBe(true);
  });
});

describe('profile editor', () => {
  it('opens as a page inside the settings dialog and Back returns to the list', () => {
    openSettings('signatures');
    $('addProfileBtn').click();
    expect($('settingsModal').contains($('profileEditorModal'))).toBe(true);
    expect(shown('profileEditorModal')).toBe(true);
    expect(shown('settingsMain')).toBe(false);
    $('profileEditorClose').click();
    expect(shown('profileEditorModal')).toBe(false);
    expect(shown('settingsMain')).toBe(true);
  });

  it('keeps the section list from switching pages while the editor is open', () => {
    openSettings('signatures');
    $('addProfileBtn').click();
    document.querySelector('.settings-tab[data-section="advanced"]').click();
    expect($('settingsPageTitle').textContent).toBe('Signing');
    expect(shown('profileEditorModal')).toBe(true);
  });

  it('asks for a name next to the field instead of in a message box', async () => {
    openSettings('signatures');
    $('addProfileBtn').click();
    $('profileEditorSave').click();
    await vi.waitFor(() => expect($('profileName').getAttribute('aria-invalid')).toBe('true'));
    expect($('profileNameError').classList.contains('hidden')).toBe(false);
    expect(showMessage).not.toHaveBeenCalled();
    expect(SignatureService.SaveSignatureProfile).not.toHaveBeenCalled();
  });
});

describe('certificate folders and libraries', () => {
  it('lists paths with the full path on hover and a remove button', () => {
    openSettings('certificates');
    const row = $('librariesList').querySelector('.path-row');
    expect(row.querySelector('.path').dataset.tip).toBe('/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so');
    expect(row.querySelector('.path-tail').textContent).toBe('opensc-pkcs11.so');
    expect(row.querySelector('.cert-lib-remove').getAttribute('aria-label')).toMatch(/Remove/);
  });

  it('removes a path that contains a double quote', async () => {
    ConfigService.Get.mockResolvedValue({ theme: 'dark', certificateStores: ['/x/a"b', '/y'], tokenLibraries: [] });
    document.body.innerHTML = body;
    await initSettings();
    openSettings('certificates');
    $('storesList').querySelector('.cert-store-remove').click();
    expect(getSetting('certificateStores')).toEqual(['/y']);
  });

  it('scopes the restore buttons in their labels', () => {
    expect($('restoreDefaultStoresBtn').textContent.trim()).toBe('Restore default folders');
    expect($('restoreDefaultLibsBtn').textContent.trim()).toBe('Restore default libraries');
  });

  it('draws the restore buttons as ghost buttons with an icon, like Refresh', () => {
    for (const id of ['restoreDefaultStoresBtn', 'restoreDefaultLibsBtn', 'refreshCertsBtn']) {
      expect($(id).classList.contains('btn-ghost')).toBe(true);
      expect($(id).querySelector('[data-icon], svg')).not.toBeNull();
    }
  });
});

describe('certificate rows', () => {
  const now = Date.now();
  const iso = (days) => new Date(now + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const cert = (fields) => ({
    name: 'GARCIA LOPEZ MARIA', issuer: 'AC DNIE 004', subject: 'CN=GARCIA LOPEZ MARIA, C=ES',
    fingerprint: 'AA:BB', source: 'pkcs11', isValid: true, canSign: true, validTo: iso(400), ...fields
  });
  const row = (fields) => {
    const div = document.createElement('div');
    div.innerHTML = renderCertificateItem(cert(fields));
    return div.firstElementChild;
  };

  it('formats dates unambiguously, never M/D/YYYY', () => {
    const text = formatDate('2028-03-14 10:00:00');
    expect(text).toMatch(/14/);
    expect(text).toMatch(/Mar/);
    expect(text).toMatch(/2028/);
    expect(text).not.toMatch(/\d+\/\d+\/\d+/);
  });

  it('shows a valid certificate as a success pill', () => {
    const status = row({}).querySelector('.cert-status');
    expect(status.textContent.trim()).toBe('Valid');
    expect(status.classList.contains('success')).toBe(true);
  });

  it('shows a certificate that expires soon as a warning pill', () => {
    const status = row({ validTo: iso(10) }).querySelector('.cert-status');
    expect(status.classList.contains('pill')).toBe(true);
    expect(status.classList.contains('warning')).toBe(true);
    expect(status.textContent).toMatch(/Expires in (9|10) days/);
  });

  it('counts hours, not rounded days, around the expiry moment', () => {
    const hours = (h) => new Date(now + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    expect(row({ isValid: false, validTo: hours(-3) }).querySelector('.cert-status').textContent.trim()).toBe('Expired');
    expect(row({ validTo: hours(3) }).querySelector('.cert-status').textContent.trim()).toBe('Expires today');
    expect(row({ validTo: hours(30) }).querySelector('.cert-status').textContent.trim()).toBe('Expires tomorrow');
  });

  it('mutes an expired certificate and one without a private key, with the reason', () => {
    const expired = row({ isValid: false, validTo: iso(-3) }).querySelector('.cert-status');
    expect(expired.textContent.trim()).toBe('Expired');
    expect(expired.classList.contains('success')).toBe(false);
    expect(expired.classList.contains('warning')).toBe(false);

    const viewOnly = row({ canSign: false }).querySelector('.cert-status');
    expect(viewOnly.textContent.trim()).toBe("Can't sign");
    expect(viewOnly.title).toMatch(/private key/);
  });

  it('states the expiry once in the details: the Valid dates, no Status line repeating them', () => {
    const terms = (el) => [...el.querySelectorAll('.cert-details dt')].map((dt) => dt.textContent);
    expect(terms(row({ validTo: iso(10) }))).toEqual(['Subject', 'Issuer', 'Valid']);
    expect(terms(row({ isValid: false, validTo: iso(-3) }))).toEqual(['Subject', 'Issuer', 'Valid']);
    // A reason the dates don't give stays.
    const viewOnly = row({ canSign: false });
    expect(terms(viewOnly)).toEqual(['Status', 'Subject', 'Issuer', 'Valid']);
    expect(viewOnly.querySelector('.cert-details dd').textContent).toMatch(/private key/);
  });

  it('names the source and shows the subject in mono with a copy button', () => {
    const el = row({ source: 'nss' });
    expect(el.querySelector('.cert-source').textContent.trim()).toBe('Browser store');
    expect(el.querySelector('.cert-dn').textContent).toBe('CN=GARCIA LOPEZ MARIA, C=ES');
    expect(el.querySelector('[data-copy]').dataset.copy).toBe('CN=GARCIA LOPEZ MARIA, C=ES');
  });
});
