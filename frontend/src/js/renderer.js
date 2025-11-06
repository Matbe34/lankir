// PDF Rendering Module
// Handles page rendering in both single-page and scroll modes

import { state, getActivePDF } from './state.js';
import { updateStatus } from './utils.js';
import { updateCurrentPageFromScroll, lazyLoadVisiblePages } from './pageLoader.js';

/**
 * Render a single page in single-page view mode
 */
export async function renderPage(pageNum) {
    try {
        const activePDF = getActivePDF();
        if (!activePDF) return;
        
        updateStatus(`Rendering page ${pageNum + 1}...`);
        
        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, 150);
        
        if (pageInfo) {
            activePDF.currentPage = pageNum;
            activePDF.renderedPages.set(pageNum, pageInfo);
            
            // Update viewer
            const viewer = document.getElementById('pdfViewer');
            viewer.className = 'pdf-viewer';
            viewer.innerHTML = `
                <div class="pdf-page-container" style="transform: scale(${state.zoomLevel});">
                    <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}"/>
                </div>
            `;
            
            // Update controls
            updatePageControls();
            updateStatus(`Page ${pageNum + 1} of ${activePDF.totalPages}`);
        }
        
    } catch (error) {
        console.error('Error rendering page:', error);
        updateStatus('Error rendering page: ' + error);
    }
}

/**
 * Render PDF in scroll mode (all pages)
 */
export async function renderScrollMode() {
    try {
        const activePDF = getActivePDF();
        if (!activePDF) return;
        
        const viewer = document.getElementById('pdfViewer');
        viewer.className = 'pdf-viewer scroll-mode';
        viewer.innerHTML = '';
        
        // Create placeholder divs for all pages first (instant)
        for (let i = 0; i < activePDF.totalPages; i++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'pdf-page-container';
            pageDiv.dataset.pageNumber = i;
            pageDiv.style.transform = `scale(${state.zoomLevel})`;
            pageDiv.style.minHeight = '800px'; // Estimated page height
            pageDiv.innerHTML = '<div class="page-loading">Page ' + (i + 1) + '</div>';
            viewer.appendChild(pageDiv);
        }
        
        // Add scroll listener immediately
        viewer.removeEventListener('scroll', updateCurrentPageFromScroll);
        viewer.addEventListener('scroll', updateCurrentPageFromScroll);
        viewer.addEventListener('scroll', lazyLoadVisiblePages);
        
        // Load first few visible pages immediately
        const { loadVisiblePages } = await import('./pageLoader.js');
        await loadVisiblePages();
        
        // Continue loading remaining pages in background
        const { loadRemainingPagesInBackground } = await import('./pageLoader.js');
        loadRemainingPagesInBackground(activePDF);
        
        updateStatus(`PDF loaded - ${activePDF.totalPages} pages`);
        
    } catch (error) {
        console.error('Error rendering scroll mode:', error);
        updateStatus('Error loading pages: ' + error);
    }
}

/**
 * Render cached PDF (fast restore from memory)
 */
export function renderCachedPDF(pdfData) {
    // Update page thumbnails
    loadPageThumbnailsFromCache(pdfData);
    
    // Render the PDF using cached data
    if (state.viewMode === 'scroll') {
        renderScrollModeFromCache(pdfData);
    } else {
        renderPageFromCache(pdfData.currentPage, pdfData);
    }
    
    updateStatus(`Viewing: ${pdfData.fileName}`);
}

/**
 * Render a single page from cache
 */
export function renderPageFromCache(pageNum, pdfData) {
    const pageInfo = pdfData.renderedPages.get(pageNum);
    
    if (pageInfo) {
        // Update viewer
        const viewer = document.getElementById('pdfViewer');
        viewer.className = 'pdf-viewer';
        viewer.innerHTML = `
            <div class="pdf-page-container" style="transform: scale(${state.zoomLevel});">
                <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}"/>
            </div>
        `;
        
        // Update controls
        updatePageControls();
    }
}

/**
 * Render scroll mode from cached pages
 */
export function renderScrollModeFromCache(pdfData) {
    const viewer = document.getElementById('pdfViewer');
    viewer.className = 'pdf-viewer scroll-mode';
    
    // Build HTML string for better performance
    let html = '';
    for (let i = 0; i < pdfData.totalPages; i++) {
        const pageInfo = pdfData.renderedPages.get(i);
        
        if (pageInfo) {
            html += `
                <div class="pdf-page-container" data-page-number="${i}" style="transform: scale(${state.zoomLevel});">
                    <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${i + 1}" data-page="${i}"/>
                </div>
            `;
        } else {
            html += `
                <div class="pdf-page-container" data-page-number="${i}" style="transform: scale(${state.zoomLevel}); min-height: 800px;">
                    <div class="page-loading">Page ${i + 1}</div>
                </div>
            `;
        }
    }
    
    // Single DOM update (much faster than appendChild in loop)
    viewer.innerHTML = html;
    
    // Add scroll listeners
    viewer.removeEventListener('scroll', updateCurrentPageFromScroll);
    viewer.addEventListener('scroll', updateCurrentPageFromScroll);
    viewer.removeEventListener('scroll', lazyLoadVisiblePages);
    viewer.addEventListener('scroll', lazyLoadVisiblePages);
    
    // Load any missing visible pages
    import('./pageLoader.js').then(({ loadVisiblePages }) => {
        loadVisiblePages();
    });
}

/**
 * Load page thumbnails from cache
 */
function loadPageThumbnailsFromCache(pdfData) {
    const pageList = document.getElementById('pageList');
    pageList.innerHTML = '';
    
    for (let i = 0; i < pdfData.totalPages; i++) {
        const pageItem = document.createElement('div');
        pageItem.className = 'page-item';
        if (i === pdfData.currentPage) {
            pageItem.classList.add('active');
        }
        pageItem.innerHTML = `<div class="page-number">Page ${i + 1}</div>`;
        pageItem.addEventListener('click', () => {
            document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
            pageItem.classList.add('active');
            
            if (state.viewMode === 'single') {
                renderPage(i);
            } else {
                scrollToPage(i);
            }
        });
        pageList.appendChild(pageItem);
    }
}

/**
 * Scroll to a specific page in scroll mode
 */
export function scrollToPage(pageNum) {
    const viewer = document.getElementById('pdfViewer');
    const page = viewer.querySelector(`[data-page="${pageNum}"]`);
    if (page) {
        page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Change to a different page (single-page mode)
 */
export function changePage(newPage) {
    const activePDF = getActivePDF();
    if (!activePDF) return;
    
    if (newPage >= 0 && newPage < activePDF.totalPages) {
        renderPage(newPage);
        
        // Update active state in sidebar
        document.querySelectorAll('.page-item').forEach((el, idx) => {
            el.classList.toggle('active', idx === newPage);
        });
    }
}

/**
 * Update page controls (placeholder for removed UI elements)
 */
function updatePageControls() {
    // Page controls removed from UI
}
