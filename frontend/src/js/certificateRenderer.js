import { escapeHtml } from './utils.js';

/** Returns human-readable certificate type name. */
export function getCertTypeName(source) {
    switch (source) {
        case 'pkcs11': return 'Smart Card';
        case 'pkcs12': return 'File';
        case 'nss': return 'Browser';
        default: return source;
    }
}

/** Formats a date string for display. */
export function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    } catch {
        return dateString;
    }
}

/** Calculates days until certificate expiry. */
export function getDaysUntilExpiry(validTo) {
    if (!validTo) return null;
    try {
        const expiryDate = new Date(validTo);
        const now = new Date();
        const diffTime = expiryDate - now;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } catch {
        return null;
    }
}

/** Renders a single certificate item as HTML. */
export function renderCertificateItem(cert, options = {}) {
    const {
        selectable = true,
        showExpiry = false,
        includeCapabilities = false
    } = options;

    // Determine if certificate can be used for signing
    const canUse = cert.isValid && cert.canSign;
    const disabledClass = selectable && !canUse ? 'invalid' : '';
    
    // Build disabled reason
    let disabledReason = '';
    if (selectable && !canUse) {
        if (!cert.isValid) {
            disabledReason = 'Certificate expired or not yet valid';
        } else if (!cert.canSign) {
            disabledReason = 'Certificate does not have private key for signing';
        }
    }

    // Determine status display
    let statusClass = cert.isValid ? 'valid' : 'invalid';
    let statusText = cert.isValid ? '✓ Valid' : '✗ Invalid';
    
    if (showExpiry && cert.isValid) {
        const daysUntilExpiry = getDaysUntilExpiry(cert.validTo);
        if (daysUntilExpiry !== null) {
            if (daysUntilExpiry <= 30) {
                statusClass = 'warning';
                statusText = `⚠ Expires in ${daysUntilExpiry}d`;
            } else {
                statusText = `✓ Valid (${daysUntilExpiry}d left)`;
            }
        }
    }

    // Build HTML
    return `
        <div class="certificate-item ${disabledClass}" 
             data-fingerprint="${escapeHtml(cert.fingerprint)}" 
             ${disabledReason ? `title="${escapeHtml(disabledReason)}"` : ''}>
            <div class="cert-header">
                <div>
                    <div class="cert-name">${escapeHtml(cert.name || 'Unknown Certificate')}</div>
                    <span class="cert-type-badge ${cert.source}">${getCertTypeName(cert.source)}</span>
                    ${!cert.canSign ? '<span class="cert-warning-badge" title="No private key - cannot sign">⚠ View Only</span>' : ''}
                </div>
                <span class="cert-status ${statusClass}">
                    ${statusText}
                </span>
            </div>
            <div class="cert-details">
                <div class="cert-detail-row">
                    <span class="cert-detail-label">Subject:</span>
                    <span>${escapeHtml(cert.subject || 'N/A')}</span>
                </div>
                <div class="cert-detail-row">
                    <span class="cert-detail-label">Issuer:</span>
                    <span>${escapeHtml(cert.issuer || 'Unknown')}</span>
                </div>
                <div class="cert-detail-row">
                    <span class="cert-detail-label">Valid Until:</span>
                    <span>${formatDate(cert.validTo)}</span>
                </div>
                ${includeCapabilities && cert.keyUsage && cert.keyUsage.length > 0 ? `
                    <div class="cert-capabilities">
                        ${cert.keyUsage.map(usage => `<span class="cert-capability">${escapeHtml(usage)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/** Renders a list of certificates as HTML. */
export function renderCertificateList(certificates, options = {}) {
    if (!certificates || certificates.length === 0) {
        return `
            <div class="empty-state">
                <p>No certificates found</p>
            </div>
        `;
    }

    return `
        <div class="certificate-list">
            ${certificates.map(cert => renderCertificateItem(cert, options)).join('')}
        </div>
    `;
}

/** Attaches click handlers to certificate items for selection. */
export function attachCertificateHandlers(container, certificates, onSelect) {
    const certItems = container.querySelectorAll('.certificate-item:not(.invalid)');
    
    certItems.forEach(item => {
        item.addEventListener('click', () => {
            // Deselect all
            certItems.forEach(i => i.classList.remove('selected'));
            
            // Select this one
            item.classList.add('selected');
            
            // Find and call callback with selected certificate
            const fingerprint = item.dataset.fingerprint;
            const cert = certificates.find(c => c.fingerprint === fingerprint);
            if (cert && onSelect) {
                onSelect(cert);
            }
        });
    });

    // Auto-select first valid certificate
    if (certItems.length > 0) {
        const firstItem = certItems[0];
        firstItem.classList.add('selected');
        const fingerprint = firstItem.dataset.fingerprint;
        const cert = certificates.find(c => c.fingerprint === fingerprint);
        if (cert && onSelect) {
            onSelect(cert);
        }
    }
}
