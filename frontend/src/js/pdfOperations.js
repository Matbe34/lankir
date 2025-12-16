// PDF Operations Module
// Handles opening PDFs, loading metadata, and managing PDF operations

import { state, getActivePDF } from './state.js';
import { updateStatus, escapeHtml, formatDate, updatePageIndicator, updateScrollProgress, sanitizeError } from './utils.js';
import { createPDFTab, switchToTab } from './pdfManager.js';
import { renderPage, renderScrollMode, scrollToPage } from './renderer.js';
import { showLoading, hideLoading } from './loadingIndicator.js';

/**
 * Check if a PDF is already open and return its tab ID
 */
function findOpenPDFTab(filePath) {
    for (const [tabId, pdfData] of state.openPDFs) {
        if (pdfData.filePath === filePath) {
            return tabId;
        }
    }
    return null;
}

/**
 * Open a PDF file via file dialog
 */
export async function openPDFFile() {
    try {
        updateStatus('Opening PDF...');
        showLoading('Opening PDF file...');
        
        // Call Go backend to open PDF
        const metadata = await window.go.pdf.PDFService.OpenPDF();
        
        if (metadata) {
            // Check if this PDF is already open
            const existingTabId = findOpenPDFTab(metadata.filePath);
            
            if (existingTabId !== null) {
                // PDF already open, just switch to that tab
                switchToTab(existingTabId);
                updateStatus(`Switched to already open PDF: ${metadata.filePath.split('/').pop()}`);
                hideLoading();
                return;
            }
            
            // Create a new tab for this PDF
            const tabId = createPDFTab(metadata.filePath, metadata);
            
            // Load page thumbnails
            await loadPageThumbnails(metadata.pageCount);
            
            // Switch to the new tab
            switchToTab(tabId);
            
            // Add to recent files
            await window.go.pdf.RecentFilesService.AddRecent(metadata.filePath, metadata.pageCount);
        } else {
            updateStatus('Ready');
        }
        
    } catch (error) {
        console.error('Error opening PDF:', error);
        updateStatus('Error opening PDF: ' + sanitizeError(error));
    } finally {
        hideLoading();
    }
}

/**
 * Open a recent file by path
 */
export async function openRecentFile(filePath) {
    try {
        updateStatus('Opening ' + filePath.split('/').pop() + '...');
        showLoading('Opening recent file...');
        
        // Check if this PDF is already open
        const existingTabId = findOpenPDFTab(filePath);
        
        if (existingTabId !== null) {
            // PDF already open, just switch to that tab
            switchToTab(existingTabId);
            updateStatus(`Switched to already open PDF: ${filePath.split('/').pop()}`);
            hideLoading();
            return;
        }
        
        // Call Go backend to open PDF by path
        const metadata = await window.go.pdf.PDFService.OpenPDFByPath(filePath);
        
        if (metadata) {
            // Create a new tab for this PDF
            const tabId = createPDFTab(metadata.filePath, metadata);
            
            // Load page thumbnails
            await loadPageThumbnails(metadata.pageCount);
            
            // Switch to the new tab
            switchToTab(tabId);
            
            // Recent files are already tracked by the backend
        }
        
    } catch (error) {
        console.error('Error opening recent file:', error);
        updateStatus('Error opening file: ' + sanitizeError(error));
    } finally {
        hideLoading();
    }
}

/**
 * Update UI with PDF metadata
 */
export function updateUIForPDF(pdfData) {
    // Enable buttons
    const signBtn = document.getElementById('signBtn');
    if (signBtn) signBtn.disabled = false;
    
    // Update properties panel
    document.getElementById('fileName').textContent = pdfData.fileName;
    document.getElementById('pageCount').textContent = pdfData.totalPages;
    
    // Load signature information
    loadSignatureInfo(pdfData.filePath);
    
    // Update status
    updateStatus(`Opened: ${pdfData.fileName}`);
    
    // Update status bar
    updatePageIndicator(pdfData.currentPage + 1, pdfData.totalPages);
    updateScrollProgress(0);
}

/**
 * Load signature information for a PDF
 */
export async function loadSignatureInfo(pdfPath) {
    const signatureInfoContainer = document.getElementById('signatureInfo');
    
    try {
        // Show loading state
        signatureInfoContainer.innerHTML = `
            <div class="empty-state">
                <div class="loading-spinner"></div>
                <p>Checking signatures...</p>
            </div>
        `;
        
        // Call backend to verify signatures
        const signatures = await window.go.signature.SignatureService.VerifySignatures(pdfPath);
        
        if (!signatures || signatures.length === 0) {
            signatureInfoContainer.innerHTML = `
                <div class="empty-state">
                    <p>No signatures found</p>
                </div>
            `;
            return;
        }
        
        // Display signatures
        let html = '';
        signatures.forEach((sig, index) => {
            const statusClass = sig.isValid ? 'valid' : 'invalid';
            const statusText = sig.isValid ? 'Valid' : 'Invalid';
            const statusIcon = sig.isValid ? '✓' : '✗';
            
            const certWarning = !sig.certificateValid && sig.isValid;
            
            html += `
                <div class="signature-item ${statusClass}">
                    <div class="signature-status">
                        <span class="signature-status-badge ${statusClass}">
                            ${statusIcon} ${statusText}
                        </span>
                    </div>
            `;
            
            if (!sig.isValid && sig.validationMessage) {
                html += `
                    <div class="signature-detail" style="color: #ef4444; margin-bottom: 0.75rem; padding: 0.75rem; background-color: rgba(239, 68, 68, 0.1); border-radius: 0.25rem; border-left: 3px solid #ef4444;">
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">✗ Signature Validation Failed</div>
                        <div style="font-size: 0.8125rem;">${escapeHtml(sig.validationMessage)}</div>
                    </div>
                `;
            }
            
            if (certWarning) {
                // Provide more context based on the validation message
                let explanation = '';
                const validationMsg = sig.certificateValidationMessage || 'Certificate validation failed';
                
                if (validationMsg.toLowerCase().includes('unknown') || validationMsg.toLowerCase().includes('corrupted')) {
                    explanation = `
                        <div style="font-size: 0.75rem; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(245, 158, 11, 0.2);">
                            <strong>What this means:</strong><br>
                            The signature itself is cryptographically valid, but the certificate's trust chain cannot be fully verified. 
                            This is common with government-issued certificates (DNIe, eID) that aren't in the system's default trust store.
                            <br><br>
                            <strong>The signature is still legally valid</strong> - the document integrity is verified and the signer identity is confirmed.
                        </div>
                    `;
                }
                
                html += `
                    <div class="signature-detail" style="color: #f59e0b; margin-bottom: 0.75rem; padding: 0.75rem; background-color: rgba(245, 158, 11, 0.1); border-radius: 0.25rem; border-left: 3px solid #f59e0b;">
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">⚠ Certificate Validation Issue</div>
                        <div style="font-size: 0.8125rem; margin-bottom: 0.25rem;">${escapeHtml(validationMsg)}</div>
                        ${explanation}
                    </div>
                `;
            }
            
            if (!sig.certificateValid && sig.certificateValidationMessage) {
                html += `
                    <div class="signature-detail" style="color: #f59e0b; margin-bottom: 0.75rem; padding: 0.75rem; background-color: rgba(245, 158, 11, 0.1); border-radius: 0.25rem; border-left: 3px solid #f59e0b;">
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">⚠ Certificate Issue</div>
                        <div style="font-size: 0.8125rem;">${escapeHtml(sig.certificateValidationMessage)}</div>
                    </div>
                `;
            }
            
            if (sig.signerName) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Signer:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.signerName)}</span>
                    </div>
                `;
            }
            
            if (sig.signingTime) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Date:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.signingTime)}</span>
                    </div>
                `;
            }
            
            if (sig.signingHashAlgorithm) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Algorithm:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.signingHashAlgorithm)}</span>
                    </div>
                `;
            }
            
            if (sig.signatureType) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Type:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.signatureType)}</span>
                    </div>
                `;
            }
            
            if (sig.reason) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Reason:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.reason)}</span>
                    </div>
                `;
            }
            
            if (sig.location) {
                html += `
                    <div class="signature-detail">
                        <span class="signature-detail-label">Location:</span>
                        <span class="signature-detail-value">${escapeHtml(sig.location)}</span>
                    </div>
                `;
            }
            
            html += `</div>`;
        });
        
        signatureInfoContainer.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading signature info:', error);
        signatureInfoContainer.innerHTML = `
            <div class="empty-state">
                <p style="color: #ef4444;">Error checking signatures</p>
            </div>
        `;
    }
}

/**
 * Load page thumbnails for sidebar
 */
export async function loadPageThumbnails(pageCount) {
    try {
        const pageList = document.getElementById('pageList');
        pageList.innerHTML = '';
        
        for (let i = 0; i < pageCount; i++) {
            const pageItem = document.createElement('div');
            pageItem.className = 'page-item';
            if (i === 0) pageItem.classList.add('active');
            pageItem.innerHTML = `<div class="page-number">Page ${i + 1}</div>`;
            pageItem.addEventListener('click', async () => {
                try {
                    document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
                    pageItem.classList.add('active');
                    
                    const { state } = await import('./state.js');
                    if (state.viewMode === 'single') {
                        renderPage(i);
                    } else {
                        scrollToPage(i);
                    }
                } catch (error) {
                    console.error(`Error navigating to page ${i + 1}:`, error);
                    updateStatus('Error navigating to page');
                }
            });
            pageList.appendChild(pageItem);
        }
    } catch (error) {
        console.error('Error loading page thumbnails:', error);
        // Non-critical error, thumbnails are optional
    }
}

/**
 * Reload PDF in backend (for tab switching)
 */
export async function reloadPDFInBackend(pdfData) {
    try {
        // Clear the viewer first
        const viewer = document.getElementById('pdfViewer');
        viewer.innerHTML = '<div class="empty-state"><p>Loading PDF...</p></div>';
        
        // Open the PDF in the backend
        const metadata = await window.go.pdf.PDFService.OpenPDFByPath(pdfData.filePath);
        
        if (metadata) {
            // Update the PDF data with fresh metadata
            pdfData.metadata = metadata;
            pdfData.totalPages = metadata.pageCount;
            
            // Update UI with this PDF's data
            updateUIForPDF(pdfData);
            
            // Load thumbnails and render pages
            await loadPageThumbnails(metadata.pageCount);
            
            const { state } = await import('./state.js');
            // Render the PDF
            if (state.viewMode === 'scroll') {
                await renderScrollMode();
            } else {
                await renderPage(pdfData.currentPage);
            }
        }
    } catch (error) {
        console.error('Error reloading PDF in backend:', error);
        updateStatus('Error switching to tab: ' + sanitizeError(error));
    }
}

/**
 * Reload PDF in backend asynchronously (background)
 */
export async function reloadPDFInBackendAsync(pdfData) {
    // Silent background reload - don't show loading screen
    try {
        await window.go.pdf.PDFService.OpenPDFByPath(pdfData.filePath);
    } catch (error) {
        console.error('Background PDF reload error:', error);
    }
}

/**
 * Set view mode (single page or scroll)
 */
export function setViewMode(mode) {
    import('./state.js').then(({ state }) => {
        state.viewMode = mode;
        
        // Re-render with new mode
        const activePDF = getActivePDF();
        if (activePDF) {
            if (mode === 'single') {
                renderPage(activePDF.currentPage);
            } else {
                renderScrollMode();
            }
        }
    });
}
