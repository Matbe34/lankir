// Signature Module
// Handles PDF signing operations and certificate management

import { state, getActivePDF } from './state.js';
import { updateStatus, escapeHtml, formatDate } from './utils.js';
import { createPDFTab, switchToTab } from './pdfManager.js';
import { loadPageThumbnails, loadSignatureInfo } from './pdfOperations.js';
import { showMessage, showConfirm } from './messageDialog.js';

/**
 * Get friendly name for certificate type
 */
function getCertTypeName(source) {
    const types = {
        'pkcs11': 'Smart Card',
        'nss': 'NSS Database',
        'file': 'File',
        'system': 'System'
    };
    return types[source] || source;
}

/**
 * Initiate PDF signing workflow
 */
export async function signPDF() {
    try {
        updateStatus('Preparing to sign PDF...');
        
        const activePDF = getActivePDF();
        if (!activePDF) {
            updateStatus('No PDF loaded');
            return;
        }
        
        // Show certificate selection dialog
        await showCertificateDialog(activePDF.filePath);
        
    } catch (error) {
        console.error('Error signing PDF:', error);
        updateStatus('Error signing PDF');
    }
}

/**
 * Show certificate selection dialog
 */
export async function showCertificateDialog(pdfPath) {
    const dialog = document.getElementById('certDialog');
    const listContainer = document.getElementById('certificateListContainer');
    const pinSection = document.getElementById('pinInputSection');
    const pinInput = document.getElementById('pinInput');
    const signBtn = document.getElementById('certDialogSign');
    
    // Reset state
    state.selectedCertificate = null;
    pinInput.value = '';
    pinSection.classList.add('hidden');
    signBtn.disabled = true;
    
    // Show loading state
    listContainer.innerHTML = `
        <div class="empty-state">
            <div class="loading-spinner"></div>
            <p>Loading certificates...</p>
        </div>
    `;
    
    // Show dialog
    dialog.classList.remove('hidden');
    
    try {
        // Load certificates from backend
        const certificates = await window.go.signature.SignatureService.ListCertificates();
        
        if (!certificates || certificates.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <p>No certificates found</p>
                    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
                        Please ensure you have a valid certificate installed in your system or connected via smart card.
                    </p>
                </div>
            `;
            return;
        }
        
        // Filter to show certificates, exclude root CAs (self-signed)
        const signingCerts = certificates.filter(cert => {
            // Exclude root CAs (self-signed certificates where issuer == subject)
            if (cert.issuer === cert.subject) return false;
            
            return true;
        });
        
        // Sort: signable certificates first, then by validity
        signingCerts.sort((a, b) => {
            // First priority: can sign + valid
            const aCanUse = a.canSign && a.isValid;
            const bCanUse = b.canSign && b.isValid;
            if (aCanUse && !bCanUse) return -1;
            if (!aCanUse && bCanUse) return 1;
            
            // Second priority: can sign (even if expired)
            if (a.canSign && !b.canSign) return -1;
            if (!a.canSign && b.canSign) return 1;
            
            // Third priority: valid (even if can't sign)
            if (a.isValid && !b.isValid) return -1;
            if (!a.isValid && b.isValid) return 1;
            
            return 0;
        });
        
        if (signingCerts.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <p>No certificates found</p>
                    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
                        Found ${certificates.length} certificate(s), but they are all root CAs or system certificates.
                    </p>
                </div>
            `;
            return;
        }
        
        // Count usable certificates
        const usableCerts = signingCerts.filter(c => c.canSign && c.isValid).length;
        
        console.log(`Found ${signingCerts.length} certificates, ${usableCerts} can be used for signing`);
        
        // Render certificate list
        renderCertificateList(signingCerts, pdfPath);
        
    } catch (error) {
        console.error('Error loading certificates:', error);
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>Error loading certificates</p>
                <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
                    ${error}
                </p>
            </div>
        `;
    }
}

/**
 * Render certificate list in dialog
 */
export function renderCertificateList(certificates, pdfPath) {
    const listContainer = document.getElementById('certificateListContainer');
    const pinSection = document.getElementById('pinInputSection');
    const signBtn = document.getElementById('certDialogSign');
    
    const html = `
        <div class="certificate-list">
            ${certificates.map(cert => {
                const canUse = cert.isValid && cert.canSign;
                const disabledClass = !canUse ? 'invalid' : '';
                const disabledReason = !cert.isValid ? 'Certificate expired or not yet valid' : 
                                      !cert.canSign ? 'Certificate does not have private key for signing' : '';
                
                return `
                <div class="certificate-item ${disabledClass}" data-fingerprint="${cert.fingerprint}" ${disabledReason ? `title="${disabledReason}"` : ''}>
                    <div class="cert-header">
                        <div>
                            <div class="cert-name">${escapeHtml(cert.name)}</div>
                            <span class="cert-type-badge ${cert.source}">${getCertTypeName(cert.source)}</span>
                            ${!cert.canSign ? '<span class="cert-warning-badge" title="No private key - cannot sign">⚠ View Only</span>' : ''}
                        </div>
                        <span class="cert-status ${cert.isValid ? 'valid' : 'invalid'}">
                            ${cert.isValid ? '✓ Valid' : '✗ Invalid'}
                        </span>
                    </div>
                    <div class="cert-details">
                        <div class="cert-detail-row">
                            <span class="cert-detail-label">Subject:</span>
                            <span>${escapeHtml(cert.subject)}</span>
                        </div>
                        <div class="cert-detail-row">
                            <span class="cert-detail-label">Issuer:</span>
                            <span>${escapeHtml(cert.issuer)}</span>
                        </div>
                        <div class="cert-detail-row">
                            <span class="cert-detail-label">Valid Until:</span>
                            <span>${formatDate(cert.validTo)}</span>
                        </div>
                        ${cert.keyUsage && cert.keyUsage.length > 0 ? `
                            <div class="cert-capabilities">
                                ${cert.keyUsage.map(usage => `<span class="cert-capability">${escapeHtml(usage)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
    
    listContainer.innerHTML = html;
    
    // Add click handlers to certificate items (only valid ones with private keys)
    const certItems = listContainer.querySelectorAll('.certificate-item:not(.invalid)');
    certItems.forEach(item => {
        item.addEventListener('click', () => {
            // Deselect all
            certItems.forEach(i => i.classList.remove('selected'));
            
            // Select this one
            item.classList.add('selected');
            
            // Store selected certificate
            const fingerprint = item.dataset.fingerprint;
            state.selectedCertificate = certificates.find(c => c.fingerprint === fingerprint);
            
            // Show PIN input and enable sign button
            pinSection.classList.remove('hidden');
            signBtn.disabled = false;
            
            // Focus PIN input
            document.getElementById('pinInput').focus();
        });
    });
    
    // Store pdfPath for signing
    signBtn.dataset.pdfPath = pdfPath;
}

/**
 * Close certificate dialog
 */
export function closeCertificateDialog() {
    const dialog = document.getElementById('certDialog');
    dialog.classList.add('hidden');
    state.selectedCertificate = null;
    document.getElementById('pinInput').value = '';
}

/**
 * Perform the actual PDF signing operation
 */
export async function performSigning() {
    const signBtn = document.getElementById('certDialogSign');
    const pdfPath = signBtn.dataset.pdfPath;
    const pinInput = document.getElementById('pinInput');
    const pin = pinInput.value;
    
    if (!state.selectedCertificate) {
        updateStatus('No certificate selected');
        return;
    }
    
    if (!pin) {
        await showMessage('Please enter your PIN', 'PIN Required', 'warning');
        pinInput.focus();
        return;
    }
    
    try {
        // Disable button and show loading
        signBtn.disabled = true;
        signBtn.innerHTML = '<span class="loading-spinner"></span> Signing...';
        updateStatus('Signing PDF...');
        
        // Call backend to sign PDF
        const signedPath = await window.go.signature.SignatureService.SignPDF(
            pdfPath,
            state.selectedCertificate.fingerprint,
            pin
        );
        
        // Close dialog
        closeCertificateDialog();
        
        // Show success message
        updateStatus(`PDF signed successfully: ${signedPath}`);
        
        // Optionally open the signed PDF
        const openSigned = await showConfirm(
            `PDF signed successfully!\n\nSigned file: ${signedPath}\n\nWould you like to open the signed PDF?`,
            'Success'
        );
        if (openSigned) {
            await openSignedPDF(signedPath);
        }
        
    } catch (error) {
        console.error('Error signing PDF:', error);
        await showMessage(`Error signing PDF:\n\n${error}`, 'Signature Error', 'error');
        updateStatus('Error signing PDF');
        
        // Re-enable button
        signBtn.disabled = false;
        signBtn.innerHTML = 'Sign PDF';
    }
}

/**
 * Open a signed PDF file
 */
async function openSignedPDF(filePath) {
    try {
        // Import the openRecentFile function which already has duplicate checking
        const { openRecentFile } = await import('./pdfOperations.js');
        await openRecentFile(filePath);
    } catch (error) {
        console.error('Error opening signed PDF:', error);
    }
}
