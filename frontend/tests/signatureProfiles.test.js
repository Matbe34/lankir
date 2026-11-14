import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { SignatureService } from '../src/js/backend.js';

vi.mock('../src/js/messageDialog.js', () => ({
  showMessage: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => true)
}));

const { initSignatureProfiles, loadSignatureProfiles } = await import('../src/js/signatureProfiles.js');
const { hasSavedPosition } = await import('../src/js/signaturePlacement.js');
const { hydrateIcons } = await import('../src/js/icons.js');

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);

beforeEach(() => {
  document.body.innerHTML = body;
  initSignatureProfiles();
  SignatureService.ListSignatureProfiles.mockResolvedValue([]);
  SignatureService.SaveSignatureProfile.mockResolvedValue();
});

describe('profiles list', () => {
  it('draws an invisible profile with its own icon, not the one of the Certificates section', async () => {
    SignatureService.ListSignatureProfiles.mockResolvedValue([{ id: 'i', name: 'Invisible', visibility: 'invisible', isDefault: true }]);
    await loadSignatureProfiles();
    hydrateIcons();
    const profileIcon = document.querySelector('.profile-list-item .list-row-icon svg').innerHTML;
    const certificatesIcon = document.querySelector('.settings-tab[data-section="certificates"] svg').innerHTML;
    expect(profileIcon).not.toBe(certificatesIcon);
  });

  it('keeps Edit on every row and shows the quieter Delete only on row hover or focus', async () => {
    SignatureService.ListSignatureProfiles.mockResolvedValue([{ id: 'v', name: 'Visible', visibility: 'visible', isDefault: false }]);
    await loadSignatureProfiles();
    const edit = document.querySelector('.profile-edit-btn');
    const remove = document.querySelector('.profile-delete-btn');
    expect(edit.classList.contains('on-row-hover')).toBe(false);
    expect(remove.classList.contains('on-row-hover')).toBe(true);
    expect(remove.classList.contains('quiet')).toBe(true);
  });
});

describe('profile editor', () => {
  it('saves a new profile with a UUID and its free-text location', async () => {
    $('addProfileBtn').click();
    $('profileName').value = 'Office';
    $('profileLocation').value = 'Barcelona, Spain';
    $('profileEditorSave').click();
    await vi.waitFor(() => expect(SignatureService.SaveSignatureProfile).toHaveBeenCalled());
    const saved = SignatureService.SaveSignatureProfile.mock.calls[0][0];
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saved.location).toBe('Barcelona, Spain');
  });

  it('says a profile without a default position starts the box centred, as initialBox places it', () => {
    const help = $('profileDefinePosition').closest('.pref-row').querySelector('.pref-help').textContent;
    expect(help).toBe('Off: the box starts in the middle of the current page');
  });

  it('forgets a saved position when "Define signature position" is unchecked', async () => {
    const custom = {
      id: 'p1', name: 'Corner', visibility: 'visible', isDefault: false,
      position: { page: 1, x: 40, y: 30, width: 150, height: 60 }, appearance: {}
    };
    SignatureService.ListSignatureProfiles.mockResolvedValue([custom]);
    await loadSignatureProfiles();
    document.querySelector('.profile-edit-btn').click();
    expect($('profileDefinePosition').checked).toBe(true);

    $('profileDefinePosition').checked = false;
    $('profileDefinePosition').dispatchEvent(new Event('change'));
    $('profileEditorSave').click();
    await vi.waitFor(() => expect(SignatureService.SaveSignatureProfile).toHaveBeenCalled());
    const saved = SignatureService.SaveSignatureProfile.mock.calls[0][0];
    expect(hasSavedPosition(saved)).toBe(false);
  });

  it('previews the location from the profile without any network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    $('addProfileBtn').click();
    $('profileVisibility').value = 'visible';
    $('profileVisibility').dispatchEvent(new Event('change'));
    $('profileLocation').value = 'Girona';
    $('profileShowLocation').checked = true;
    $('profileShowLocation').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($('signaturePreview').textContent).toContain('Girona'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
