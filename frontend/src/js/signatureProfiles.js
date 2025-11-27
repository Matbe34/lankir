import { showMessage, showConfirm } from './messageDialog.js';

let currentEditingProfileId = null;
let cachedLocation = null;
let currentIconDataUrl = null;

export function initSignatureProfiles() {
    setupProfileEditor();
    setupAddProfileButton();
}

export async function loadSignatureProfiles() {
    const listContainer = document.getElementById('signatureProfilesList');

    if (!listContainer) {
        return;
    }

    try {
        listContainer.innerHTML = `
            <div class="empty-state">
                <div class="loading-spinner"></div>
                <p>Loading profiles...</p>
            </div>
        `;

        const profiles = await window.go.signature.SignatureService.ListSignatureProfiles();

        if (!profiles || profiles.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <p>No signature profiles found</p>
                </div>
            `;
            return;
        }

        renderProfilesList(profiles, listContainer);

    } catch (error) {
        console.error('Error loading signature profiles:', error);
        listContainer.innerHTML = `
            <div class="empty-state">
                <p style="color: var(--error-red);">Error loading profiles</p>
                <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
                    ${error}
                </p>
            </div>
        `;
    }
}

function renderProfilesList(profiles, container) {
    const html = profiles.map(profile => {
        const visibilityLabel = profile.visibility === 'visible' ? 'Visible' : 'Invisible';
        const visibilityClass = profile.visibility === 'visible' ? 'visible' : 'invisible';

        return `
            <div class="profile-list-item" data-profile-id="${profile.id}">
                <div class="profile-info">
                    <div class="profile-name">
                        ${escapeHtml(profile.name)}
                        ${profile.isDefault ? '<span class="profile-default-badge">Default</span>' : ''}
                    </div>
                    <div class="profile-details">
                        <span class="profile-visibility ${visibilityClass}">${visibilityLabel}</span>
                        ${profile.description ? `<span class="profile-description">${escapeHtml(profile.description)}</span>` : ''}
                    </div>
                </div>
                <div class="profile-actions">
                    <button class="btn btn-small profile-edit-btn" data-profile-id="${profile.id}" title="Edit profile">
                        Edit
                    </button>
                    <button class="btn btn-small btn-danger profile-delete-btn" data-profile-id="${profile.id}" title="Delete profile">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.profile-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const profileId = btn.dataset.profileId;
            const profile = profiles.find(p => p.id === profileId);
            if (profile) {
                openProfileEditor(profile);
            }
        });
    });

    container.querySelectorAll('.profile-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            btn.disabled = true;

            const profileId = btn.dataset.profileId;
            const profile = profiles.find(p => p.id === profileId);
            if (profile) {
                await deleteProfile(profile);
            }

            btn.disabled = false;
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupAddProfileButton() {
    const addBtn = document.getElementById('addProfileBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            openProfileEditor(null);
        });
    }
}

function setupProfileEditor() {
    const modal = document.getElementById('profileEditorModal');
    const closeBtn = document.getElementById('profileEditorClose');
    const cancelBtn = document.getElementById('profileEditorCancel');
    const saveBtn = document.getElementById('profileEditorSave');
    const visibilitySelect = document.getElementById('profileVisibility');
    const visibleSettings = document.getElementById('visibleProfileSettings');

    const closeModal = () => {
        modal.classList.add('hidden');
        currentEditingProfileId = null;
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    visibilitySelect.addEventListener('change', () => {
        if (visibilitySelect.value === 'visible') {
            visibleSettings.classList.remove('hidden');
        } else {
            visibleSettings.classList.add('hidden');
        }
        updatePreview();
    });

    const definePositionCheckbox = document.getElementById('profileDefinePosition');
    const positionSettings = document.getElementById('profilePositionSettings');

    if (definePositionCheckbox && positionSettings) {
        definePositionCheckbox.addEventListener('change', () => {
            if (definePositionCheckbox.checked) {
                positionSettings.classList.remove('hidden');
            } else {
                positionSettings.classList.add('hidden');
            }
        });
    }

    const showIconCheckbox = document.getElementById('profileShowIcon');
    const iconSettings = document.getElementById('profileIconSettings');
    const iconFileInput = document.getElementById('profileIconFile');

    if (showIconCheckbox && iconSettings) {
        showIconCheckbox.addEventListener('change', () => {
            if (showIconCheckbox.checked) {
                iconSettings.classList.remove('hidden');
            } else {
                iconSettings.classList.add('hidden');
            }
            updatePreview();
        });
    }

    if (iconFileInput) {
        iconFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 2 * 1024 * 1024) {
                    await showMessage('Image file is too large. Maximum size is 2MB.', 'File Too Large', 'warning');
                    iconFileInput.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    currentIconDataUrl = event.target.result;
                    updatePreview();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    const iconPosition = document.getElementById('profileIconPosition');
    if (iconPosition) {
        iconPosition.addEventListener('change', updatePreview);
    }

    saveBtn.addEventListener('click', async () => {
        await saveProfile();
    });

    const previewFields = [
        'profileShowSignerName',
        'profileShowSigningTime',
        'profileShowLocation',
        'profileCustomText'
    ];

    previewFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', updatePreview);
            field.addEventListener('change', updatePreview);
        }
    });
}

function openProfileEditor(profile) {
    const modal = document.getElementById('profileEditorModal');
    const title = document.getElementById('profileEditorTitle');
    const visibleSettings = document.getElementById('visibleProfileSettings');
    const visibilitySelect = document.getElementById('profileVisibility');

    if (profile) {
        currentEditingProfileId = profile.id;
        title.textContent = 'Edit Signature Profile';
    } else {
        currentEditingProfileId = null;
        title.textContent = 'Create Signature Profile';
        profile = {};
    }

    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileDescription').value = profile.description || '';
    visibilitySelect.value = profile.visibility || 'invisible';
    document.getElementById('profileIsDefault').checked = profile.isDefault || false;

    document.getElementById('profileShowSignerName').checked = profile.appearance?.showSignerName ?? true;
    document.getElementById('profileShowSigningTime').checked = profile.appearance?.showSigningTime ?? true;
    document.getElementById('profileShowLocation').checked = profile.appearance?.showLocation ?? false;
    document.getElementById('profileCustomText').value = profile.appearance?.customText || '';

    const showIcon = profile.appearance?.showLogo || false;
    document.getElementById('profileShowIcon').checked = showIcon;
    document.getElementById('profileIconPosition').value = profile.appearance?.logoPosition || 'left';
    currentIconDataUrl = profile.appearance?.logoPath || null;

    const iconSettings = document.getElementById('profileIconSettings');
    if (showIcon) {
        iconSettings.classList.remove('hidden');
    } else {
        iconSettings.classList.add('hidden');
    }

    const hasCustomPosition = profile.position && (profile.position.x !== 360 || profile.position.y !== 50 || profile.position.width !== 200 || profile.position.height !== 80 || profile.position.page !== 0);
    document.getElementById('profileDefinePosition').checked = hasCustomPosition;

    document.getElementById('profilePage').value = (profile.position?.page ?? 0).toString();
    document.getElementById('profileX').value = profile.position?.x ?? 360;
    document.getElementById('profileY').value = profile.position?.y ?? 50;
    document.getElementById('profileWidth').value = profile.position?.width ?? 200;
    document.getElementById('profileHeight').value = profile.position?.height ?? 80;

    const positionSettings = document.getElementById('profilePositionSettings');
    if (hasCustomPosition) {
        positionSettings.classList.remove('hidden');
    } else {
        positionSettings.classList.add('hidden');
    }

    if (visibilitySelect.value === 'visible') {
        visibleSettings.classList.remove('hidden');
    } else {
        visibleSettings.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    updatePreview();
}

async function fetchLocation() {
    if (cachedLocation) {
        return cachedLocation;
    }

    try {
        const response = await fetch('https://ipinfo.io/json?token=');
        const data = await response.json();
        cachedLocation = `${data.city}, ${data.country}`;
        return cachedLocation;
    } catch (error) {
        console.error('Failed to fetch location:', error);
        return 'Location unavailable';
    }
}

async function updatePreview() {
    const previewContainer = document.getElementById('signaturePreview');
    const visibility = document.getElementById('profileVisibility').value;

    if (visibility !== 'visible') {
        previewContainer.innerHTML = '<div class="preview-empty">Select "Visible" signature type to see preview</div>';
        return;
    }

    const showSignerName = document.getElementById('profileShowSignerName').checked;
    const showSigningTime = document.getElementById('profileShowSigningTime').checked;
    const showLocation = document.getElementById('profileShowLocation').checked;
    const customText = document.getElementById('profileCustomText').value.trim();
    const showIcon = document.getElementById('profileShowIcon').checked;
    const iconPosition = document.getElementById('profileIconPosition').value;

    const lines = [];

    if (showSignerName) {
        lines.push('<div class="preview-line"><span class="preview-label">Signed by:</span> John Doe (example)</div>');
    }

    if (showSigningTime) {
        const now = new Date().toLocaleString();
        lines.push(`<div class="preview-line"><span class="preview-label">Date:</span> ${now}</div>`);
    }

    if (showLocation) {
        const location = await fetchLocation();
        lines.push(`<div class="preview-line"><span class="preview-label">Location:</span> ${location}</div>`);
    }

    if (customText) {
        lines.push(`<div class="preview-line" style="margin-top: 0.5rem;">${escapeHtml(customText)}</div>`);
    }

    if (lines.length === 0 && !showIcon) {
        previewContainer.innerHTML = '<div class="preview-empty">Select at least one field to display</div>';
        return;
    }

    let iconHtml = '';
    if (showIcon && currentIconDataUrl) {
        iconHtml = `<img src="${currentIconDataUrl}" alt="Signature icon" style="max-width: 60px; max-height: 60px; object-fit: contain;">`;
    } else if (showIcon) {
        iconHtml = '<div style="width: 60px; height: 60px; background: var(--border-color); border-radius: 0.25rem; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-secondary);">Icon</div>';
    }

    const textContent = lines.join('');

    let finalHtml = '';
    if (iconPosition === 'top') {
        finalHtml = `
            <div class="signature-preview-box">
                ${iconHtml ? `<div style="display: flex; justify-content: center; margin-bottom: 0.5rem;">${iconHtml}</div>` : ''}
                ${textContent}
            </div>
        `;
    } else {
        finalHtml = `
            <div class="signature-preview-box" style="display: flex; gap: 1rem; align-items: ${textContent ? 'flex-start' : 'center'};">
                ${iconHtml ? `<div style="flex-shrink: 0;">${iconHtml}</div>` : ''}
                <div style="flex: 1;">${textContent}</div>
            </div>
        `;
    }

    previewContainer.innerHTML = finalHtml;
}

async function saveProfile() {
    const modal = document.getElementById('profileEditorModal');
    const saveBtn = document.getElementById('profileEditorSave');

    try {
        const name = document.getElementById('profileName').value.trim();
        const description = document.getElementById('profileDescription').value.trim();
        const visibility = document.getElementById('profileVisibility').value;
        const isDefault = document.getElementById('profileIsDefault').checked;

        if (!name) {
            await showMessage('Please enter a profile name', 'Validation Error', 'warning');
            document.getElementById('profileName').focus();
            return;
        }

        if (isDefault) {
            const profiles = await window.go.signature.SignatureService.ListSignatureProfiles();
            for (const p of profiles) {
                if (p.isDefault && p.id !== currentEditingProfileId) {
                    p.isDefault = false;
                    await window.go.signature.SignatureService.SaveSignatureProfile(p);
                }
            }
        }

        const profile = {
            id: currentEditingProfileId || generateProfileId(name),
            name: name,
            description: description,
            visibility: visibility,
            reason: 'Document digitally signed',
            location: 'Digital Signature',
            contactInfo: '',
            isDefault: isDefault,
            position: {
                page: 0,
                x: 0,
                y: 0,
                width: 0,
                height: 0
            },
            appearance: {
                showSignerName: false,
                showSigningTime: false,
                showLocation: false,
                customText: '',
                fontSize: 10
            }
        };

        if (visibility === 'visible') {
            profile.position = {
                page: parseInt(document.getElementById('profilePage').value) || 0,
                x: parseFloat(document.getElementById('profileX').value) || 360,
                y: parseFloat(document.getElementById('profileY').value) || 50,
                width: parseFloat(document.getElementById('profileWidth').value) || 200,
                height: parseFloat(document.getElementById('profileHeight').value) || 80
            };

            profile.appearance = {
                showSignerName: document.getElementById('profileShowSignerName').checked,
                showSigningTime: document.getElementById('profileShowSigningTime').checked,
                showLocation: document.getElementById('profileShowLocation').checked,
                customText: document.getElementById('profileCustomText').value.trim(),
                showLogo: document.getElementById('profileShowIcon').checked,
                logoPath: currentIconDataUrl || '',
                logoPosition: document.getElementById('profileIconPosition').value,
                fontSize: 10
            };
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        await window.go.signature.SignatureService.SaveSignatureProfile(profile);

        modal.classList.add('hidden');
        currentEditingProfileId = null;

        await showMessage(
            `Profile "${name}" saved successfully!`,
            'Success',
            'success'
        );

        await loadSignatureProfiles();

    } catch (error) {
        console.error('Error saving profile:', error);
        await showMessage(
            `Error saving profile:\n\n${error}`,
            'Error',
            'error'
        );
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Profile';
    }
}

async function deleteProfile(profile) {
    try {
        const confirmed = await showConfirm(
            `Are you sure you want to delete the profile "${profile.name}"?\n\nThis action cannot be undone.`,
            'Delete Profile'
        );

        if (!confirmed) {
            return;
        }

        await window.go.signature.SignatureService.DeleteSignatureProfile(profile.id);

        await showMessage(
            `Profile "${profile.name}" deleted successfully!`,
            'Success',
            'success'
        );

        await loadSignatureProfiles();

    } catch (error) {
        console.error('Error deleting profile:', error);
        await showMessage(
            `Error deleting profile:\n\n${error}`,
            'Error',
            'error'
        );
    }
}

function generateProfileId(name) {
    const timestamp = Date.now();
    const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `${sanitized}-${timestamp}`;
}