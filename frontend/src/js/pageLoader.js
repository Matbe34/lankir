// Page Loading Module
// Handles lazy loading and progressive rendering of PDF pages

import { state, getActivePDF } from './state.js';
import { updateStatus, updatePageIndicator, updateScrollProgress } from './utils.js';

const LAZY_LOAD_BUFFER = 1000;  // Pixels above/below viewport to preload
const LAZY_LOAD_DEBOUNCE_MS = 100;  // Debounce delay for scroll events
const BACKGROUND_LOAD_BATCH_SIZE = 3;  // Pages to load before yielding to UI
const BACKGROUND_LOAD_DELAY_MS = 10;  // Delay between background load batches

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
        const isVisible = rect.top < viewerRect.bottom + LAZY_LOAD_BUFFER && 
                         rect.bottom > viewerRect.top - LAZY_LOAD_BUFFER;

        if (isVisible && !activePDF.renderedPages.has(index) && !state.loadingPages.has(index)) {
            state.loadingPages.add(index);
            loadPromises.push(loadPage(index, pageDiv, activePDF));
        }
    });

    await Promise.all(loadPromises);
}

const DPI_SCALE = 96 / 150;

export async function loadPage(pageNum, pageDiv, activePDF) {
    try {
        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, 150);
        activePDF.renderedPages.set(pageNum, pageInfo);

        const baseWidth = pageInfo.width * DPI_SCALE;
        const baseHeight = pageInfo.height * DPI_SCALE;

        pageDiv.dataset.width = baseWidth;
        pageDiv.dataset.height = baseHeight;

        const width = baseWidth * state.zoomLevel;
        const height = baseHeight * state.zoomLevel;

        pageDiv.style.width = `${width}px`;
        pageDiv.style.height = `${height}px`;

        pageDiv.innerHTML = `
            <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}" data-page="${pageNum}" style="width: 100%; height: 100%;"/>
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

export async function loadRemainingPagesInBackground(activePDF) {
    const viewer = document.getElementById('pdfViewer');
    const pageDivs = viewer.querySelectorAll('.pdf-page-container');

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
                if (i % BACKGROUND_LOAD_BATCH_SIZE === 0) {
                    await new Promise(resolve => setTimeout(resolve, BACKGROUND_LOAD_DELAY_MS));
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

    const scrollTop = viewer.scrollTop;
    const scrollHeight = viewer.scrollHeight - viewer.clientHeight;

    let closestPage = 0;
    let minDistance = Infinity;

    const pageRects = Array.from(pages).map(page => page.getBoundingClientRect());

    pageRects.forEach((rect, index) => {
        const distance = Math.abs(rect.top);

        if (distance < minDistance) {
            minDistance = distance;
            closestPage = index;
        }
    });

    // BATCH WRITES: Now perform all DOM modifications
    if (activePDF && closestPage !== activePDF.currentPage) {
        activePDF.currentPage = closestPage;

        // Update active page in sidebar
        document.querySelectorAll('.page-item').forEach((el, idx) => {
            el.classList.toggle('active', idx === activePDF.currentPage);
        });

        // Update status bar
        updatePageIndicator(activePDF.currentPage + 1, activePDF.totalPages);
    }

    // Calculate and update scroll progress
    if (activePDF) {
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
    }, LAZY_LOAD_DEBOUNCE_MS);
}
