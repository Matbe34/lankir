import { getSetting, setSetting } from './settings.js';
import { showMessage } from './messageDialog.js';
import { escapeHtml } from './utils.js';
import { renderCertificateList } from './certificateRenderer.js';

export function initCertificatesSettings() {
    setupStoreManagement();
    setupLibraryManagement();
    setupCertificateDetection();
    setupRestoreDefaults();
    renderLists();
}

function setupRestoreDefaults() {
    const restoreStoresBtn = document.getElementById('restoreDefaultStoresBtn');
    const restoreLibsBtn = document.getElementById('restoreDefaultLibsBtn');

    if (restoreStoresBtn) {
        restoreStoresBtn.addEventListener('click', async () => {
            const defaults = await window.go.signature.SignatureService.GetDefaultCertificateSources();
            const allDefaults = [...(defaults.system || []), ...(defaults.user || [])];
            setSetting('certificateStores', allDefaults);
            renderStoresList();
            showMessage('Default certificate stores restored', 'Success', 'success');
        });
    }

    if (restoreLibsBtn) {
        restoreLibsBtn.addEventListener('click', async () => {
            const defaults = await window.go.signature.SignatureService.GetDefaultTokenLibraries();
            setSetting('tokenLibraries', defaults);
            renderLibrariesList();
            showMessage('Default token libraries restored', 'Success', 'success');
        });
    }
}

function setupStoreManagement() {
    const addBtn = document.getElementById('addCertStoreBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            try {
                let result;
                if (window.go && window.go.main && window.go.main.App) {
                    result = await window.go.main.App.OpenDirectoryDialog("Select Certificate Store Directory");
                } else {
                    throw new Error("Backend service not available");
                }

                if (result) {
                    addStore(result);
                }
            } catch (error) {
                console.error("File dialog error:", error);
                showMessage('Failed to open file dialog: ' + error.message, 'Error', 'error');
            }
        });
    }
}

function addStore(path) {
    const stores = getSetting('certificateStores') || [];
    if (stores.includes(path)) {
        showMessage('Store already exists', 'Warning', 'warning');
        return;
    }
    setSetting('certificateStores', [...stores, path]);
    renderStoresList();
}

function removeStore(path) {
    const stores = getSetting('certificateStores') || [];
    setSetting('certificateStores', stores.filter(s => s !== path));
    renderStoresList();
}

function setupLibraryManagement() {
    const addBtn = document.getElementById('addTokenLibBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            try {
                let result;
                if (window.go && window.go.main && window.go.main.App) {
                    result = await window.go.main.App.OpenFileDialog(
                        "Select PKCS#11 Library",
                        [
                            { DisplayName: "Shared Libraries (*.so, *.dll, *.dylib)", Pattern: "*.so;*.dll;*.dylib" },
                            { DisplayName: "All Files (*.*)", Pattern: "*.*" }
                        ]
                    );
                } else {
                    throw new Error("Backend service not available");
                }

                if (result) {
                    addLibrary(result);
                }
            } catch (error) {
                console.error("File dialog error:", error);
                showMessage('Failed to open file dialog: ' + error.message, 'Error', 'error');
            }
        });
    }
}

function addLibrary(path) {
    const libs = getSetting('tokenLibraries') || [];
    if (libs.includes(path)) {
        showMessage('Library already exists', 'Warning', 'warning');
        return;
    }
    setSetting('tokenLibraries', [...libs, path]);
    renderLibrariesList();
}

function removeLibrary(path) {
    const libs = getSetting('tokenLibraries') || [];
    setSetting('tokenLibraries', libs.filter(l => l !== path));
    renderLibrariesList();
}

async function renderLists() {
    await renderStoresList();
    await renderLibrariesList();
    await loadCertificates();
}

async function renderStoresList() {
    const container = document.getElementById('storesList');
    if (!container) return;

    const stores = getSetting('certificateStores') || [];

    if (stores.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No stores configured</p></div>';
        return;
    }

    const html = stores.map(path => {
        const displayPath = path.length > 60 ? '...' + path.slice(-57) : path;

        return `
            <div class="profile-list-item">
                <div class="profile-info">
                    <div class="profile-name" title="${escapeHtml(path)}">
                        ${escapeHtml(displayPath)}
                    </div>
                </div>
                <div class="profile-actions">
                    <button class="btn btn-small btn-danger cert-store-remove" data-path="${escapeHtml(path)}" title="Remove">
                        Remove
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.cert-store-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.path;
            removeStore(path);
        });
    });
}

async function renderLibrariesList() {
    const container = document.getElementById('librariesList');
    if (!container) return;

    const libs = getSetting('tokenLibraries') || [];

    if (libs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No libraries configured</p></div>';
        return;
    }

    const html = libs.map(path => {
        const displayPath = path.length > 60 ? '...' + path.slice(-57) : path;

        return `
            <div class="profile-list-item">
                <div class="profile-info">
                    <div class="profile-name" title="${escapeHtml(path)}">
                        ${escapeHtml(displayPath)}
                    </div>
                </div>
                <div class="profile-actions">
                    <button class="btn btn-small btn-danger cert-lib-remove" data-path="${escapeHtml(path)}" title="Remove">
                        Remove
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.cert-lib-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.path;
            removeLibrary(path);
        });
    });
}

function setupCertificateDetection() {
    const refreshBtn = document.getElementById('refreshCertsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadCertificates);
    }
}

async function loadCertificates() {
    const container = document.getElementById('certificatesList');
    const spinner = document.getElementById('certsLoadingSpinner');
    const text = document.getElementById('certsLoadingText');

    if (!container) return;

    if (spinner) spinner.classList.remove('hidden');
    if (text) text.textContent = 'Scanning...';

    try {
        if (window.go && window.go.signature && window.go.signature.SignatureService) {
            const certs = await window.go.signature.SignatureService.ListCertificates();
            renderCertificates(certs);
        } else {
            console.error("SignatureService not available");
            if (text) text.textContent = 'Backend service not available';
        }
    } catch (error) {
        console.error("Failed to list certificates:", error);
        if (text) text.textContent = 'Failed to scan: ' + error.message;
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

function renderCertificates(certs) {
    const container = document.getElementById('certificatesList');
    if (!container) return;

    if (!certs || certs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No certificates found</p></div>';
        return;
    }

    const html = renderCertificateList(certs, {
        selectable: false,
        showExpiry: true,
        includeCapabilities: false
    });
    
    container.innerHTML = html;
}
