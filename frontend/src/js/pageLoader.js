// Page Loading Module
// Handles lazy loading and progressive rendering of PDF pages

import { state, getActivePDF } from './state.js';
import { updateStatus, updatePageIndicator, updateScrollProgress } from './utils.js';

/**
 * Load visible pages in the viewport
 */
export async function loadVisiblePages() {
    const activePDF = getActivePDF();
    if (!activePDF) return;
    
    const viewer = document.getElementById('pdfViewer');
    const viewerRect = viewer.getBoundingClientRect();
    const pageDivs = viewer.querySelectorAll('.pdf-page-container');
    
    // Load pages that are visible or near visible
    const loadPromises = [];
    pageDivs.forEach((pageDiv, index) => {
        const rect = pageDiv.getBoundingClientRect();
        const isVisible = rect.top < viewerRect.bottom + 1000 && rect.bottom > viewerRect.top - 1000;
        
        if (isVisible && !activePDF.renderedPages.has(index) && !state.loadingPages.has(index)) {
            state.loadingPages.add(index);
            loadPromises.push(loadPage(index, pageDiv, activePDF));
        }
    });
    
    await Promise.all(loadPromises);
}

/**
 * Load a single page
 */
export async function loadPage(pageNum, pageDiv, activePDF) {
    try {
        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, 150);
        activePDF.renderedPages.set(pageNum, pageInfo);
        
        pageDiv.innerHTML = `
            <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}" data-page="${pageNum}"/>
        `;
        
        // Update actual height
        pageDiv.style.minHeight = '';
    } catch (error) {
        console.error(`Error loading page ${pageNum}:`, error);
        pageDiv.innerHTML = '<div class="page-error">Error loading page ' + (pageNum + 1) + '</div>';
    } finally {
        state.loadingPages.delete(pageNum);
    }
}

/**
 * Load remaining pages in background (non-blocking)
 */
export async function loadRemainingPagesInBackground(activePDF) {
    const viewer = document.getElementById('pdfViewer');
    const pageDivs = viewer.querySelectorAll('.pdf-page-container');
    
    // Load pages in batches to not block UI
    for (let i = 0; i < activePDF.totalPages; i++) {
        if (!activePDF.renderedPages.has(i) && !state.loadingPages.has(i)) {
            const pageDiv = pageDivs[i];
            if (pageDiv) {
                state.loadingPages.add(i);
                // Don't await - let it load in background
                loadPage(i, pageDiv, activePDF).then(() => {
                    // Update status occasionally
                    const loaded = activePDF.renderedPages.size;
                    if (loaded % 5 === 0) {
                        updateStatus(`Loaded ${loaded}/${activePDF.totalPages} pages in background`);
                    }
                });
                
                // Small delay between pages to keep UI responsive
                if (i % 3 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
    }
}

/**
 * Update current page number based on scroll position
 */
export function updateCurrentPageFromScroll() {
    const activePDF = getActivePDF();
    if (!activePDF) return;
    
    const viewer = document.getElementById('pdfViewer');
    const pages = viewer.querySelectorAll('.pdf-page');
    
    let closestPage = 0;
    let minDistance = Infinity;
    
    pages.forEach((page, index) => {
        const rect = page.getBoundingClientRect();
        const distance = Math.abs(rect.top);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestPage = index;
        }
    });
    
    if (activePDF && closestPage !== activePDF.currentPage) {
        activePDF.currentPage = closestPage;
        
        // Update active page in sidebar
        document.querySelectorAll('.page-item').forEach((el, idx) => {
            el.classList.toggle('active', idx === activePDF.currentPage);
        });
    }
    
    // Update status bar
    if (activePDF) {
        updatePageIndicator(activePDF.currentPage + 1, activePDF.totalPages);
        
        // Calculate scroll progress
        const scrollTop = viewer.scrollTop;
        const scrollHeight = viewer.scrollHeight - viewer.clientHeight;
        const scrollPercentage = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        updateScrollProgress(scrollPercentage);
    }
}

/**
 * Debounced lazy loading on scroll
 */
let lazyLoadTimeout = null;
export function lazyLoadVisiblePages() {
    if (lazyLoadTimeout) clearTimeout(lazyLoadTimeout);
    lazyLoadTimeout = setTimeout(() => {
        loadVisiblePages();
    }, 100);
}
