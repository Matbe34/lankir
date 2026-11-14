import { showMessage, showConfirm } from './messageDialog.js';
import { showToast } from './toast.js';
import { iconSvg } from './icons.js';
import { SignatureService } from './backend.js';
import { getSetting } from './settings.js';
import { hasSavedPosition, BUILT_IN_POSITION } from './signaturePlacement.js';
import { escapeHtml } from './utils.js';
import { escapeAttr } from './certificateRenderer.js';
import { stampParts, stampDate } from './stampPreview.js';

let currentEditingProfileId = null;
let currentIconDataUrl = null;

const $ = (id) => document.getElementById(id);
const toggle = (el, show) => el?.classList.toggle('hidden', !show);

/** Initializes the signature profiles editor and add button. */
export function initSignatureProfiles() {
    setupProfileEditor();
    setupAddProfileButton();
}

/** Loads and renders all signature profiles from the backend. */
export async function loadSignatureProfiles() {
    const listContainer = $('signatureProfilesList');
    if (!listContainer) return;

    try {
        listContainer.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Loading profiles…</p></div>';

        const profiles = await SignatureService.ListSignatureProfiles();

        if (!profiles || profiles.length === 0) {
            listContainer.innerHTML = '<div class="empty-state"><p>No profiles yet</p><p class="empty-state-detail">Without one, signatures are invisible.</p></div>';
            return;
        }

        renderProfilesList(profiles, listContainer);
    } catch (error) {
        console.error('Error loading signature profiles:', error);
        listContainer.innerHTML = `
            <div class="empty-state">
                ${iconSvg('circle-alert')}
                <p>Could not load the profiles</p>
                <p class="empty-state-detail">${escapeHtml(String(error?.message ?? error))}</p>
            </div>
        `;
    }
}

/** Renders the profiles list with edit and delete buttons. */
function renderProfilesList(profiles, container) {
    container.innerHTML = profiles.map((profile) => {
        const id = escapeAttr(profile.id);
        const name = escapeHtml(profile.name);
        const nameAttr = escapeAttr(profile.name);
        const type = profile.visibility === 'visible' ? 'Visible' : 'Invisible';
        const details = [type, profile.description].filter(Boolean).map(escapeHtml).join(' · ');
        return `
            <div class="list-row profile-list-item" data-profile-id="${id}">
                <span class="list-row-icon">${iconSvg(profile.visibility === 'visible' ? 'signature' : 'eye-off')}</span>
                <span class="list-row-text">
                    <span class="list-row-title">${name}</span>
                    <span class="list-row-sub">${details}</span>
                </span>
                ${profile.isDefault ? '<span class="pill">Default</span>' : ''}
                <span class="list-row-actions">
                    <button class="icon-btn sm profile-edit-btn" data-profile-id="${id}" data-tip="Edit" aria-label="Edit ${nameAttr}">${iconSvg('pencil', 'icon-sm')}</button>
                    <button class="icon-btn sm danger quiet on-row-hover profile-delete-btn" data-profile-id="${id}" data-tip="Delete" aria-label="Delete ${nameAttr}">${iconSvg('trash', 'icon-sm')}</button>
                </span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.profile-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const profile = profiles.find((p) => p.id === btn.dataset.profileId);
            if (profile) openProfileEditor(profile);
        });
    });

    container.querySelectorAll('.profile-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            btn.disabled = true;
            const profile = profiles.find((p) => p.id === btn.dataset.profileId);
            if (profile) await deleteProfile(profile);
            btn.disabled = false;
        });
    });
}

function setupAddProfileButton() {
    $('addProfileBtn')?.addEventListener('click', () => openProfileEditor(null));
}

function setNameError(show) {
    const name = $('profileName');
    if (show) name.setAttribute('aria-invalid', 'true');
    else name.removeAttribute('aria-invalid');
    toggle($('profileNameError'), show);
}

/** Wires the profile editor page of Settings. */
function setupProfileEditor() {
    const visibilitySelect = $('profileVisibility');

    $('profileEditorClose').addEventListener('click', closeProfileEditor);
    $('profileEditorCancel').addEventListener('click', closeProfileEditor);
    $('profileName').addEventListener('input', () => setNameError(false));

    visibilitySelect.addEventListener('change', () => {
        toggle($('visibleProfileSettings'), visibilitySelect.value === 'visible');
        updatePreview();
    });

    const definePosition = $('profileDefinePosition');
    definePosition?.addEventListener('change', () => toggle($('profilePositionSettings'), definePosition.checked));

    const showIcon = $('profileShowIcon');
    showIcon?.addEventListener('change', () => {
        toggle($('profileIconSettings'), showIcon.checked);
        updatePreview();
    });

    const iconFileInput = $('profileIconFile');
    iconFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            await showMessage('The image is larger than 2 MB. Choose a smaller one.', 'Image too large', 'warning');
            iconFileInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            currentIconDataUrl = event.target.result;
            updatePreview();
        };
        reader.readAsDataURL(file);
    });

    $('profileIconPosition')?.addEventListener('change', updatePreview);
    $('profileEditorSave').addEventListener('click', saveProfile);

    for (const fieldId of ['profileLocation', 'profileShowSignerName', 'profileShowSigningTime', 'profileShowLocation', 'profileCustomText']) {
        const field = $(fieldId);
        field?.addEventListener('input', updatePreview);
        field?.addEventListener('change', updatePreview);
    }
}

/** Shows the editor in place of the Settings pages; the section list stays but is inert. */
function showEditorPage(show) {
    toggle($('profileEditorModal'), show);
    toggle($('settingsMain'), !show);
    const nav = document.querySelector('#settingsModal .prefs-nav');
    nav?.toggleAttribute('inert', show);
}

/** Leaves the profile editor and returns to the Signing page. */
export function closeProfileEditor() {
    const wasOpen = !$('profileEditorModal')?.classList.contains('hidden');
    showEditorPage(false);
    currentEditingProfileId = null;
    if (wasOpen) $('addProfileBtn')?.focus();
}

/** Opens the profile editor for a new profile (null) or an existing one. */
function openProfileEditor(profile) {
    const visibilitySelect = $('profileVisibility');

    if (profile) {
        currentEditingProfileId = profile.id;
        $('profileEditorTitle').textContent = 'Edit signature profile';
    } else {
        currentEditingProfileId = null;
        $('profileEditorTitle').textContent = 'New signature profile';
        profile = {};
    }

    setNameError(false);
    $('profileName').value = profile.name || '';
    $('profileDescription').value = profile.description || '';
    $('profileLocation').value = profile.location || '';
    visibilitySelect.value = profile.visibility || 'invisible';
    $('profileIsDefault').checked = profile.isDefault || false;

    $('profileShowSignerName').checked = profile.appearance?.showSignerName ?? true;
    $('profileShowSigningTime').checked = profile.appearance?.showSigningTime ?? true;
    $('profileShowLocation').checked = profile.appearance?.showLocation ?? false;
    $('profileCustomText').value = profile.appearance?.customText || '';

    const showIcon = profile.appearance?.showLogo || false;
    $('profileShowIcon').checked = showIcon;
    $('profileIconPosition').value = profile.appearance?.logoPosition || 'left';
    $('profileIconFile').value = '';
    currentIconDataUrl = profile.appearance?.logoPath || null;
    toggle($('profileIconSettings'), showIcon);

    const hasCustomPosition = hasSavedPosition(profile);
    $('profileDefinePosition').checked = hasCustomPosition;
    $('profilePage').value = (profile.position?.page ?? 0).toString();
    $('profileX').value = profile.position?.x ?? 360;
    $('profileY').value = profile.position?.y ?? 50;
    $('profileWidth').value = profile.position?.width ?? 200;
    $('profileHeight').value = profile.position?.height ?? 80;
    toggle($('profilePositionSettings'), hasCustomPosition);

    toggle($('visibleProfileSettings'), visibilitySelect.value === 'visible');

    showEditorPage(true);
    const body = $('profileEditorModal').querySelector('.prefs-body');
    if (body) body.scrollTop = 0;
    $('profileName').focus();
    updatePreview();
}

function updatePreview() {
    const previewContainer = $('signaturePreview');
    if ($('profileVisibility').value !== 'visible') {
        previewContainer.innerHTML = '';
        return;
    }

    const appearance = {
        showSignerName: $('profileShowSignerName').checked,
        showSigningTime: $('profileShowSigningTime').checked,
        showLocation: $('profileShowLocation').checked,
        customText: $('profileCustomText').value,
        showLogo: $('profileShowIcon').checked,
        logoPosition: $('profileIconPosition').value
    };
    const location = getSetting('signatureLocationLookup') ? 'From your IP address when signing' : $('profileLocation').value.trim();
    const stamp = stampParts(appearance, {
        signerName: 'Your name', date: stampDate(), location, iconDataUrl: currentIconDataUrl, iconPlaceholder: true
    });
    previewContainer.innerHTML = stamp.html
        ? `<div class="signature-preview-box ${stamp.layout}">${stamp.html}</div>`
        : '<p class="preview-empty">Turn on at least one line to show on the page</p>';
}

async function saveProfile() {
    const saveBtn = $('profileEditorSave');

    try {
        const name = $('profileName').value.trim();
        const description = $('profileDescription').value.trim();
        const visibility = $('profileVisibility').value;
        const isDefault = $('profileIsDefault').checked;

        if (!name) {
            setNameError(true);
            $('profileName').focus();
            return;
        }

        if (isDefault) {
            const profiles = await SignatureService.ListSignatureProfiles();
            for (const p of profiles) {
                if (p.isDefault && p.id !== currentEditingProfileId) {
                    p.isDefault = false;
                    await SignatureService.SaveSignatureProfile(p);
                }
            }
        }

        const profile = {
            id: currentEditingProfileId || crypto.randomUUID(),
            name,
            description,
            visibility,
            location: $('profileLocation').value.trim(),
            isDefault,
            position: { page: 0, x: 0, y: 0, width: 0, height: 0 },
            appearance: {
                showSignerName: false,
                showSigningTime: false,
                showLocation: false,
                customText: '',
                fontSize: 10
            }
        };

        if (visibility === 'visible') {
            profile.position = $('profileDefinePosition').checked ? {
                page: parseInt($('profilePage').value) || 0,
                x: parseFloat($('profileX').value) || 360,
                y: parseFloat($('profileY').value) || 50,
                width: parseFloat($('profileWidth').value) || 200,
                height: parseFloat($('profileHeight').value) || 80
            } : { ...BUILT_IN_POSITION };

            profile.appearance = {
                showSignerName: $('profileShowSignerName').checked,
                showSigningTime: $('profileShowSigningTime').checked,
                showLocation: $('profileShowLocation').checked,
                customText: $('profileCustomText').value.trim(),
                showLogo: $('profileShowIcon').checked,
                logoPath: currentIconDataUrl || '',
                logoPosition: $('profileIconPosition').value,
                fontSize: 10
            };
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        await SignatureService.SaveSignatureProfile(profile);

        closeProfileEditor();
        showToast(`Profile "${name}" saved`, { tone: 'success' });
        await loadSignatureProfiles();
    } catch (error) {
        console.error('Error saving profile:', error);
        await showMessage('Something went wrong while saving it. Try again.', `Lankir couldn’t save “${$('profileName').value.trim()}”`, 'error', { details: String(error?.message ?? error) });
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save profile';
    }
}

async function deleteProfile(profile) {
    try {
        const confirmed = await showConfirm(
            'This can’t be undone.',
            `Delete “${profile.name}”?`,
            { confirmLabel: 'Delete', danger: true }
        );
        if (!confirmed) return;

        await SignatureService.DeleteSignatureProfile(profile.id);
        showToast(`Profile "${profile.name}" deleted`);
        await loadSignatureProfiles();
    } catch (error) {
        console.error('Error deleting profile:', error);
        await showMessage('Something went wrong while deleting it. Try again.', `Lankir couldn’t delete “${profile.name}”`, 'error', { details: String(error?.message ?? error) });
    }
}
