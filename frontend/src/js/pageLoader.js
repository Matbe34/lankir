import { state, getActivePDF } from './state.js';
import { updateStatus, updatePageIndicator, updateScrollProgress } from './utils.js';
import { PERFORMANCE, DPI } from './constants.js';

const LAZY_LOAD_BUFFER = PERFORMANCE.LAZY_LOAD_BUFFER;
const LAZY_LOAD_DEBOUNCE_MS = PERFORMANCE.LAZY_LOAD_DEBOUNCE_MS;
const BACKGROUND_LOAD_BATCH_SIZE = PERFORMANCE.BACKGROUND_LOAD_BATCH_SIZE;
const BACKGROUND_LOAD_DELAY_MS = PERFORMANCE.BACKGROUND_LOAD_DELAY_MS;

const backgroundLoadControllers = new Map();

/** Loads pages currently visible in the viewport. */
export async function loadVisiblePages() {
    try {
        const activePDF = getActivePDF();
        if (!activePDF) return;

        const viewer = document.getElementById('pdfViewer');
        const viewerRect = viewer.getBoundingClientRect();
        const pageDivs = viewer.querySelectorAll('.pdf-page-container');

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
    } catch (error) {
        console.error('Error loading visible pages:', error);
        updateStatus('Error loading pages');
    }
}

const DPI_SCALE = DPI.SCREEN / DPI.RENDER;

/** Loads and renders a single page into its container. */
export async function loadPage(pageNum, pageDiv, activePDF) {
    try {
        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, DPI.RENDER);
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

/** Progressively loads remaining pages in background with abort support. */
export async function loadRemainingPagesInBackground(activePDF) {
    try {
        if (backgroundLoadControllers.has(activePDF.id)) {
            backgroundLoadControllers.get(activePDF.id).abort();
        }
        
        const abortController = new AbortController();
        backgroundLoadControllers.set(activePDF.id, abortController);
        
        const viewer = document.getElementById('pdfViewer');
        const pageDivs = viewer.querySelectorAll('.pdf-page-container');

        for (let i = 0; i < activePDF.totalPages; i++) {
            if (abortController.signal.aborted) {
                console.log(`Background loading cancelled for PDF ${activePDF.id}`);
                break;
            }
            
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
                    }).catch(error => {
                        console.error(`Error loading page ${i} in background:`, error);
                        state.loadingPages.delete(i);
                    });

                    // Small delay between pages to keep UI responsive
                    if (i % BACKGROUND_LOAD_BATCH_SIZE === 0) {
                        await new Promise(resolve => setTimeout(resolve, BACKGROUND_LOAD_DELAY_MS));
                    }
                }
            }
        }
        
        backgroundLoadControllers.delete(activePDF.id);
    } catch (error) {
        console.error('Error in background page loading:', error);
        // Non-critical error, background loading can continue to fail silently
    }
}

/** Cancels background loading for a specific PDF. */
export function cancelBackgroundLoading(tabId) {
    if (backgroundLoadControllers.has(tabId)) {
        backgroundLoadControllers.get(tabId).abort();
        backgroundLoadControllers.delete(tabId);
        console.log(`Cancelled background loading for tab ${tabId}`);
    }
}

let rafScheduled = false;

/** Updates current page number based on scroll position. */
export function updateCurrentPageFromScroll() {
    if (rafScheduled) return;
    
    rafScheduled = true;
    requestAnimationFrame(() => {
        rafScheduled = false;
        
        const activePDF = getActivePDF();
        if (!activePDF) return;

        const viewer = document.getElementById('pdfViewer');
        const pages = viewer.querySelectorAll('.pdf-page');

        // BATCH READS: Read all layout info first
        const scrollTop = viewer.scrollTop;
        const scrollHeight = viewer.scrollHeight - viewer.clientHeight;
        const pageRects = Array.from(pages).map(page => page.getBoundingClientRect());

        // COMPUTE: Process data without touching DOM
        let closestPage = 0;
        let minDistance = Infinity;

        pageRects.forEach((rect, index) => {
            const distance = Math.abs(rect.top);
            if (distance < minDistance) {
                minDistance = distance;
                closestPage = index;
            }
        });

        const scrollPercentage = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

        // BATCH WRITES: Now perform all DOM modifications at once
        if (activePDF && closestPage !== activePDF.currentPage) {
            activePDF.currentPage = closestPage;

            // Update active page in sidebar
            document.querySelectorAll('.page-item').forEach((el, idx) => {
                el.classList.toggle('active', idx === activePDF.currentPage);
            });

            // Update status bar
            updatePageIndicator(activePDF.currentPage + 1, activePDF.totalPages);
        }

        // Update scroll progress
        if (activePDF) {
            updateScrollProgress(scrollPercentage);
        }
    });
}

/** Debounced lazy loading triggered on scroll. */
let lazyLoadTimeout = null;
export function lazyLoadVisiblePages() {
    if (lazyLoadTimeout) clearTimeout(lazyLoadTimeout);
    lazyLoadTimeout = setTimeout(() => {
        loadVisiblePages();
    }, LAZY_LOAD_DEBOUNCE_MS);
}
