import { state, getActivePDF } from './state.js';
import { updateStatus, sanitizeError } from './utils.js';
import { updateCurrentPageFromScroll, lazyLoadVisiblePages } from './pageLoader.js';
import { DPI } from './constants.js';

const DPI_SCALE = DPI.SCREEN / DPI.RENDER;

/** Map of tab IDs to their scroll event listener references. */
const scrollListeners = new Map(); // tabId -> { updateScroll, lazyLoad }

/** Renders a single PDF page by page number in single-page mode. */
export async function renderPage(pageNum) {
    try {
        const activePDF = getActivePDF();
        if (!activePDF) return;

        updateStatus(`Rendering page ${pageNum + 1}...`);

        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, DPI.RENDER);

        if (pageInfo) {
            activePDF.currentPage = pageNum;
            activePDF.renderedPages.set(pageNum, pageInfo);

            const viewer = document.getElementById('pdfViewer');
            viewer.className = 'pdf-viewer';

            const baseWidth = pageInfo.width * DPI_SCALE;
            const baseHeight = pageInfo.height * DPI_SCALE;
            const width = baseWidth * state.zoomLevel;
            const height = baseHeight * state.zoomLevel;

            viewer.innerHTML = `
                <div class="pdf-page-container" 
                     data-width="${baseWidth}" 
                     data-height="${baseHeight}"
                     style="width: ${width}px; height: ${height}px;">
                    <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}" style="width: 100%; height: 100%;"/>
                </div>
            `;

            updatePageControls();
            updateStatus(`Page ${pageNum + 1} of ${activePDF.totalPages}`);
        }

    } catch (error) {
        console.error('Error rendering page:', error);
        updateStatus('Error rendering page: ' + sanitizeError(error));
    }
}

/** Renders all pages in continuous scroll mode with lazy loading. */
export async function renderScrollMode() {
    try {
        const activePDF = getActivePDF();
        if (!activePDF) return;

        const viewer = document.getElementById('pdfViewer');
        viewer.className = 'pdf-viewer scroll-mode';
        viewer.innerHTML = '';

        cleanupScrollListeners(activePDF.id);

        // Create placeholder divs for all pages first (instant)
        for (let i = 0; i < activePDF.totalPages; i++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'pdf-page-container';
            pageDiv.dataset.pageNumber = i;

            const defaultWidth = 794;
            const defaultHeight = 1123;

            pageDiv.dataset.width = defaultWidth;
            pageDiv.dataset.height = defaultHeight;

            pageDiv.style.width = `${defaultWidth * state.zoomLevel}px`;
            pageDiv.style.height = `${defaultHeight * state.zoomLevel}px`;

            pageDiv.innerHTML = '<div class="page-loading">Page ' + (i + 1) + '</div>';
            viewer.appendChild(pageDiv);
        }

        viewer.removeEventListener('scroll', updateCurrentPageFromScroll);
        viewer.removeEventListener('scroll', lazyLoadVisiblePages);
        
        viewer.addEventListener('scroll', updateCurrentPageFromScroll);
        viewer.addEventListener('scroll', lazyLoadVisiblePages);
        scrollListeners.set(activePDF.id, { 
            updateScroll: updateCurrentPageFromScroll, 
            lazyLoad: lazyLoadVisiblePages,
            viewer: viewer
        });

        const { loadVisiblePages } = await import('./pageLoader.js');
        await loadVisiblePages();

        const { loadRemainingPagesInBackground } = await import('./pageLoader.js');
        loadRemainingPagesInBackground(activePDF);

        updateStatus(`PDF loaded - ${activePDF.totalPages} pages`);

    } catch (error) {
        console.error('Error rendering scroll mode:', error);
        updateStatus('Error loading pages: ' + sanitizeError(error));
    }
}

/** Restores a PDF view from cached page data. */
export function renderCachedPDF(pdfData) {
    loadPageThumbnailsFromCache(pdfData);

    if (state.viewMode === 'scroll') {
        renderScrollModeFromCache(pdfData);
    } else {
        renderPageFromCache(pdfData.currentPage, pdfData);
    }

    updateStatus(`Viewing: ${pdfData.fileName}`);
}

/** Renders a single page from cached data in single-page mode. */
export function renderPageFromCache(pageNum, pdfData) {
    const pageInfo = pdfData.renderedPages.get(pageNum);

    if (pageInfo) {
        const viewer = document.getElementById('pdfViewer');
        viewer.className = 'pdf-viewer';

        const baseWidth = pageInfo.width * DPI_SCALE;
        const baseHeight = pageInfo.height * DPI_SCALE;
        const width = baseWidth * state.zoomLevel;
        const height = baseHeight * state.zoomLevel;

        viewer.innerHTML = `
            <div class="pdf-page-container" 
                 data-width="${baseWidth}" 
                 data-height="${baseHeight}"
                 style="width: ${width}px; height: ${height}px;">
                <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${pageNum + 1}" style="width: 100%; height: 100%;"/>
            </div>
        `;

        // Update controls
        updatePageControls();
    }
}

/** Renders scroll mode from cached page data. */
export function renderScrollModeFromCache(pdfData) {
    const viewer = document.getElementById('pdfViewer');
    viewer.className = 'pdf-viewer scroll-mode';

    // Build HTML string for better performance
    let html = '';
    for (let i = 0; i < pdfData.totalPages; i++) {
        const pageInfo = pdfData.renderedPages.get(i);

        if (pageInfo) {
            const baseWidth = pageInfo.width * DPI_SCALE;
            const baseHeight = pageInfo.height * DPI_SCALE;
            const width = baseWidth * state.zoomLevel;
            const height = baseHeight * state.zoomLevel;

            html += `
                <div class="pdf-page-container" data-page-number="${i}" 
                     data-width="${baseWidth}" 
                     data-height="${baseHeight}"
                     style="width: ${width}px; height: ${height}px;">
                    <img src="${pageInfo.imageData}" class="pdf-page" alt="Page ${i + 1}" data-page="${i}" style="width: 100%; height: 100%;"/>
                </div>
            `;
        } else {
            const defaultWidth = 794;
            const defaultHeight = 1123;
            const width = defaultWidth * state.zoomLevel;
            const height = defaultHeight * state.zoomLevel;

            html += `
                <div class="pdf-page-container" data-page-number="${i}" 
                     data-width="${defaultWidth}" 
                     data-height="${defaultHeight}"
                     style="width: ${width}px; height: ${height}px;">
                    <div class="page-loading">Page ${i + 1}</div>
                </div>
            `;
        }
    }

    viewer.innerHTML = html;

    cleanupScrollListeners(pdfData.id);

    viewer.removeEventListener('scroll', updateCurrentPageFromScroll);
    viewer.removeEventListener('scroll', lazyLoadVisiblePages);
    
    viewer.addEventListener('scroll', updateCurrentPageFromScroll);
    viewer.addEventListener('scroll', lazyLoadVisiblePages);
    scrollListeners.set(pdfData.id, { 
        updateScroll: updateCurrentPageFromScroll, 
        lazyLoad: lazyLoadVisiblePages,
        viewer: viewer
    });

    import('./pageLoader.js').then(({ loadVisiblePages }) => {
        loadVisiblePages();
    });
}

/** Loads page thumbnails into sidebar from cached PDF data using optimized loader */
async function loadPageThumbnailsFromCache(pdfData) {
    try {
        const pageList = document.getElementById('pageList');
        pageList.innerHTML = '';

        const { initializeThumbnailLoading, setupThumbnailItems } = await import('./thumbnailLoader.js');
        const { observer } = initializeThumbnailLoading(pdfData.id, pdfData.totalPages);
        setupThumbnailItems(pdfData.id, pdfData.totalPages, observer);
    } catch (error) {
        console.error('Error loading cached thumbnails:', error);
    }
}

/** Smoothly scrolls the viewer to the specified page number. */
export function scrollToPage(pageNum) {
    const viewer = document.getElementById('pdfViewer');
    const page = viewer.querySelector(`[data-page="${pageNum}"]`);
    if (page) {
        page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/** Cleans up scroll event listeners for a tab. */
export function cleanupScrollListeners(tabId) {
    const listeners = scrollListeners.get(tabId);
    if (listeners) {
        const { updateScroll, lazyLoad, viewer } = listeners;
        if (viewer) {
            viewer.removeEventListener('scroll', updateScroll);
            viewer.removeEventListener('scroll', lazyLoad);
        }
        scrollListeners.delete(tabId);
    }
}

/** Changes to a new page in single-page mode and updates sidebar. */
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

/** Updates page controls (placeholder). */
function updatePageControls() {
    // Page controls removed from UI
}
