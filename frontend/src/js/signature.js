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
        
        // Load and show profile selection first
        await showProfileSelection(activePDF.filePath);
        
    } catch (error) {
        console.error('Error signing PDF:', error);
        updateStatus('Error signing PDF');
    }
}

/**
 * Show profile selection step
 */
async function showProfileSelection(pdfPath) {
    const dialog = document.getElementById('profileDialog');
    const profileSelect = document.getElementById('profileSelectMain');
    const profileDescription = document.getElementById('profileDescriptionMain');
    const nextBtn = document.getElementById('profileDialogNext');
    const cancelBtn = document.getElementById('profileDialogCancel');
    const closeBtn = document.getElementById('profileDialogClose');
    
    try {
        // Show dialog
        dialog.classList.remove('hidden');
        
        // Load signature profiles
        const profiles = await window.go.signature.SignatureService.ListSignatureProfiles();

        // Populate profile select
        profileSelect.innerHTML = profiles.map(profile => {
            const defaultLabel = profile.isDefault ? ' (Default)' : '';
            return `<option value="${profile.id}" ${profile.isDefault ? 'selected' : ''}>${profile.name}${defaultLabel}</option>`;
        }).join('');
        
        // Store in state for later use
        state.availableProfiles = profiles;
        state.pdfPath = pdfPath;
        
        // Select default profile
        const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];
        if (defaultProfile) {
            state.selectedProfile = defaultProfile;
            profileDescription.textContent = defaultProfile.description;
        }
        
        // Handle profile selection change
        profileSelect.onchange = (e) => {
            const profileId = e.target.value;
            const selectedProfile = profiles.find(p => p.id === profileId);
            if (selectedProfile) {
                state.selectedProfile = selectedProfile;
                profileDescription.textContent = selectedProfile.description;
            }
        };
        
        // Handle next button
        nextBtn.onclick = async () => {
            dialog.classList.add('hidden');
            
            if (state.selectedProfile.visibility === 'visible') {
                await showSignaturePlacement(pdfPath, state.selectedProfile);
            } else {
                await showCertificateDialog(pdfPath);
            }
        };
        
        // Handle cancel/close
        const closeDialog = () => {
            dialog.classList.add('hidden');
            state.selectedProfile = null;
            state.pdfPath = null;
        };
        
        cancelBtn.onclick = closeDialog;
        closeBtn.onclick = closeDialog;
        
    } catch (error) {
        console.error('Error loading profiles:', error);
        await showMessage(`Error loading signature profiles:\n\n${error}`, 'Error', 'error');
    }
}

/**
 * Show signature placement overlay for visible signatures
 */
async function showSignaturePlacement(pdfPath, profile) {
    const overlay = document.getElementById('signaturePlacementOverlay');
    const rectangle = document.getElementById('signatureRectangle');
    const confirmBtn = document.getElementById('placementConfirm');
    const cancelBtn = document.getElementById('placementCancel');
    const pdfViewer = document.getElementById('pdfViewer');
    
    // Show overlay
    overlay.classList.remove('hidden');
    
    // State for signature placement
    let isDrawing = false;
    let isDragging = false;
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let rectData = null;
    
    // Get PDF viewer bounds and current page
    const viewerRect = pdfViewer.getBoundingClientRect();
    const activePDF = getActivePDF();
    
    // Mouse down - start drawing
    const onMouseDown = (e) => {
        if (e.target.closest('.placement-header') || e.target.closest('.btn')) {
            return;
        }
        
        const rect = rectangle.getBoundingClientRect();
        const isOnRect = !rectangle.classList.contains('hidden') && 
                        e.clientX >= rect.left && e.clientX <= rect.right &&
                        e.clientY >= rect.top && e.clientY <= rect.bottom;
        
        // Check if clicking on resize handle
        const isOnHandle = isOnRect && 
                          e.clientX >= rect.right - 20 && e.clientY >= rect.bottom - 20;
        
        if (isOnHandle) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
        } else if (isOnRect) {
            isDragging = true;
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
        } else {
            isDrawing = true;
            startX = e.clientX;
            startY = e.clientY;
            rectangle.style.left = startX + 'px';
            rectangle.style.top = startY + 'px';
            rectangle.style.width = '0px';
            rectangle.style.height = '0px';
            rectangle.classList.remove('hidden');
        }
    };
    
    // Mouse move - update rectangle
    const onMouseMove = (e) => {
        if (isDrawing) {
            const width = e.clientX - startX;
            const height = e.clientY - startY;
            rectangle.style.width = Math.abs(width) + 'px';
            rectangle.style.height = Math.abs(height) + 'px';
            rectangle.style.left = (width < 0 ? e.clientX : startX) + 'px';
            rectangle.style.top = (height < 0 ? e.clientY : startY) + 'px';
        } else if (isDragging) {
            rectangle.style.left = (e.clientX - startX) + 'px';
            rectangle.style.top = (e.clientY - startY) + 'px';
        } else if (isResizing) {
            const rect = rectangle.getBoundingClientRect();
            const newWidth = Math.max(20, rect.width + (e.clientX - startX));
            const newHeight = Math.max(10, rect.height + (e.clientY - startY));
            rectangle.style.width = newWidth + 'px';
            rectangle.style.height = newHeight + 'px';
            startX = e.clientX;
            startY = e.clientY;
        }
        
        // Enable confirm button if rectangle has size
        if (!rectangle.classList.contains('hidden')) {
            const rect = rectangle.getBoundingClientRect();
            confirmBtn.disabled = rect.width < 10 || rect.height < 5;
        }
    };
    
    // Mouse up - finish drawing
    const onMouseUp = () => {
        isDrawing = false;
        isDragging = false;
        isResizing = false;
    };
    
    // Cleanup function
    const cleanup = () => {
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        overlay.classList.add('hidden');
        rectangle.classList.add('hidden');
    };
    
    // Event listeners
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // Cancel button
    cancelBtn.onclick = () => {
        cleanup();
        updateStatus('Signature placement cancelled');
    };
    
    // Confirm button
    confirmBtn.onclick = async () => {
        try {
            const rect = rectangle.getBoundingClientRect();
            
            // Convert screen coordinates to PDF coordinates
            const pdfCoords = await convertScreenToPDFCoordinates(rect, viewerRect, activePDF);
            
            // Store position in state
            state.signaturePosition = pdfCoords;
            
            cleanup();
            
            // Continue to certificate selection
            await showCertificateDialog(pdfPath);
        } catch (error) {
            console.error('Error confirming placement:', error);
            updateStatus('Error: ' + error);
            cleanup();
        }
    };
}

/**
 * Convert screen coordinates to PDF coordinates
 */
async function convertScreenToPDFCoordinates(rect, viewerRect, activePDF) {
    try {
        // Get the current zoom level
        const zoom = state.zoomLevel || 1.0;
        
        // Determine which page - find the page that contains the signature rectangle
        let targetPage = 1;
        let targetPageImg = null;
        
        // Check all visible pages to find which one contains the signature
        const allPageImgs = document.querySelectorAll('.pdf-page');
        for (const pageImg of allPageImgs) {
            const imgRect = pageImg.getBoundingClientRect();
            // Check if rectangle center is within this page
            const rectCenterY = rect.top + rect.height / 2;
            if (rectCenterY >= imgRect.top && rectCenterY <= imgRect.bottom) {
                targetPageImg = pageImg;
                // Get page number from data attribute
                const pageAttr = pageImg.getAttribute('data-page');
                if (pageAttr !== null) {
                    targetPage = parseInt(pageAttr) + 1;
                }
                break;
            }
        }
        
        // If no page found, use current page
        if (!targetPageImg) {
            targetPage = activePDF?.currentPage >= 0 ? activePDF.currentPage + 1 : 1;
            targetPageImg = document.querySelector('.pdf-page');
        }
        
        if (!targetPageImg) {
            return fallbackCoordinateConversion(rect, viewerRect, zoom, targetPage);
        }
        
        // Get actual page dimensions from backend
        const dimensions = await window.go.pdf.PDFService.GetPageDimensions(targetPage - 1);
        const pdfWidth = dimensions.width;
        const pdfHeight = dimensions.height;
        
        const imgRect = targetPageImg.getBoundingClientRect();
        
        // Calculate scaling between rendered image and PDF points
        const scaleX = pdfWidth / imgRect.width;
        const scaleY = pdfHeight / imgRect.height;
        
        // Calculate position relative to the PDF page image
        const relativeX = rect.left - imgRect.left;
        const relativeY = rect.top - imgRect.top;
        
        // Convert to PDF coordinates (origin at bottom-left)
        // The Y coordinate must be from the BOTTOM of the page
        const x = relativeX * scaleX;
        const y = pdfHeight - (relativeY * scaleY) - (rect.height * scaleY);
        const width = rect.width * scaleX;
        const height = rect.height * scaleY;
        
        console.log('Coordinate conversion:', {
            screen: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            img: { x: imgRect.left, y: imgRect.top, w: imgRect.width, h: imgRect.height },
            relative: { x: relativeX, y: relativeY },
            scale: { x: scaleX, y: scaleY },
            pdfDims: { w: pdfWidth, h: pdfHeight },
            pdf: { x, y, width, height, page: targetPage }
        });
        
        return {
            page: targetPage,
            x: Math.max(0, Math.min(x, pdfWidth - width)),
            y: Math.max(0, Math.min(y, pdfHeight - height)),
            width: width,
            height: height
        };
    } catch (error) {
        console.error('Error converting coordinates:', error);
        // Fallback
        const zoom = state.zoomLevel || 1.0;
        const page = activePDF?.currentPage >= 0 ? activePDF.currentPage + 1 : 1;
        return fallbackCoordinateConversion(rect, viewerRect, zoom, page);
    }
}

/**
 * Fallback coordinate conversion when page image not available
 */
function fallbackCoordinateConversion(rect, viewerRect, zoom, page) {
    const pdfWidth = 595;
    const pdfHeight = 842;
    
    const relativeX = rect.left - viewerRect.left;
    const relativeY = rect.top - viewerRect.top;
    
    const x = (relativeX / zoom);
    const y = pdfHeight - (relativeY / zoom) - (rect.height / zoom);
    const width = rect.width / zoom;
    const height = rect.height / zoom;
    
    return {
        page: page,
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: width,
        height: height
    };
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
    
    // Reset certificate state (keep profile from previous step)
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
    // Keep selectedProfile and signaturePosition for the signing workflow
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
    
    if (!state.selectedProfile) {
        updateStatus('No signature profile selected');
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
        
        let signedPath;
        
        // Call backend to sign PDF with selected profile and position (if visible)
        if (state.signaturePosition && state.selectedProfile.visibility === 'visible') {
            // Sign with custom position
            signedPath = await window.go.signature.SignatureService.SignPDFWithProfileAndPosition(
                pdfPath,
                state.selectedCertificate.fingerprint,
                pin,
                state.selectedProfile.id,
                state.signaturePosition
            );
        } else {
            // Sign with default profile settings
            signedPath = await window.go.signature.SignatureService.SignPDFWithProfile(
                pdfPath,
                state.selectedCertificate.fingerprint,
                pin,
                state.selectedProfile.id
            );
        }
        
        // Close dialog
        closeCertificateDialog();
        
        // Clear state
        state.signaturePosition = null;
        state.pdfPath = null;
        
        // Show success message
        const profileType = state.selectedProfile.visibility === 'visible' ? 'visible' : 'invisible';
        updateStatus(`PDF signed successfully with ${profileType} signature: ${signedPath}`);
        
        // Optionally open the signed PDF
        const openSigned = await showConfirm(
            `PDF signed successfully with ${profileType} signature!\n\nSigned file: ${signedPath}\n\nWould you like to open the signed PDF?`,
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
