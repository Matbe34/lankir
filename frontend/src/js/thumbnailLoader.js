import { getActivePDF } from './state.js';
import { updateStatus } from './utils.js';

const THUMBNAIL_DPI = 48;
const BATCH_DELAY_MS = 50;

const thumbnailObservers = new Map();
const thumbnailAbortControllers = new Map();
const thumbnailLoadQueue = new Map();

/** Initialize thumbnail loading with IntersectionObserver for lazy loading */
export function initializeThumbnailLoading(tabId, pageCount) {
    cleanupThumbnailLoading(tabId);

    const abortController = new AbortController();
    thumbnailAbortControllers.set(tabId, abortController);
    thumbnailLoadQueue.set(tabId, new Set());

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.dataset.pageNum, 10);
                    if (!isNaN(pageNum)) {
                        loadThumbnailIfNeeded(tabId, pageNum, entry.target);
                    }
                }
            });
        },
        {
            root: document.getElementById('pageList'),
            rootMargin: '200px 0px',
            threshold: 0.01,
        }
    );

    thumbnailObservers.set(tabId, observer);
    return { observer, abortController };
}

/** Setup thumbnail items and attach observer */
export function setupThumbnailItems(tabId, pageCount, observer) {
    const pageList = document.getElementById('pageList');
    if (!pageList) return;

    for (let i = 0; i < pageCount; i++) {
        const pageItem = document.createElement('div');
        pageItem.className = 'page-item';
        pageItem.dataset.pageNum = i;
        if (i === 0) pageItem.classList.add('active');

        pageItem.innerHTML = `
            <div class="page-thumbnail-container" style="width: 100%; aspect-ratio: 0.707; background: var(--bg-primary); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center;">
                <div class="page-thumbnail-loading" style="color: var(--text-secondary); font-size: 0.75rem;">•••</div>
            </div>
            <div class="page-number">Page ${i + 1}</div>
        `;

        pageItem.addEventListener('click', async () => {
            handleThumbnailClick(i);
        });

        pageList.appendChild(pageItem);
        observer.observe(pageItem);
    }

    const activePDF = getActivePDF();
    if (activePDF && activePDF.id === tabId) {
        loadPriorityThumbnails(tabId, Math.min(8, pageCount));
    }
}

async function handleThumbnailClick(pageNum) {
    try {
        document.querySelectorAll('.page-item').forEach((el) => el.classList.remove('active'));
        const clickedItem = document.querySelector(`[data-page-num="${pageNum}"]`);
        if (clickedItem) clickedItem.classList.add('active');

        const { state } = await import('./state.js');
        const { renderPage, scrollToPage } = await import('./renderer.js');

        if (state.viewMode === 'single') {
            await renderPage(pageNum);
        } else {
            scrollToPage(pageNum);
        }
    } catch (error) {
        console.error(`Error navigating to page ${pageNum + 1}:`, error);
        updateStatus('Error navigating to page');
    }
}

async function loadThumbnailIfNeeded(tabId, pageNum, pageItem) {
    const activePDF = getActivePDF();
    if (!activePDF || activePDF.id !== tabId) return;

    if (activePDF.thumbnails.has(pageNum)) {
        displayCachedThumbnail(pageNum, pageItem, activePDF);
        return;
    }

    const queue = thumbnailLoadQueue.get(tabId);
    if (queue && queue.has(pageNum)) return;

    if (queue) queue.add(pageNum);
    await loadAndCacheThumbnail(tabId, pageNum, pageItem);
    if (queue) queue.delete(pageNum);
}

async function loadPriorityThumbnails(tabId, count) {
    const activePDF = getActivePDF();
    if (!activePDF || activePDF.id !== tabId) return;

    const pageList = document.getElementById('pageList');
    if (!pageList) return;

    for (let i = 0; i < count; i++) {
        const pageItem = pageList.querySelector(`[data-page-num="${i}"]`);
        if (pageItem && !activePDF.thumbnails.has(i)) {
            await loadThumbnailIfNeeded(tabId, i, pageItem);

            if (i < count - 1) {
                await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }
    }
}

async function loadAndCacheThumbnail(tabId, pageNum, pageItem) {
    try {
        const abortController = thumbnailAbortControllers.get(tabId);
        if (abortController?.signal.aborted) return;

        const activePDF = getActivePDF();
        if (!activePDF || activePDF.id !== tabId) return;

        const thumbnailContainer = pageItem.querySelector('.page-thumbnail-container');
        if (!thumbnailContainer) return;

        const pageInfo = await window.go.pdf.PDFService.RenderPage(pageNum, THUMBNAIL_DPI);

        if (abortController?.signal.aborted) return;
        if (!activePDF || activePDF.id !== tabId) return;

        if (pageInfo?.imageData) {
            activePDF.thumbnails.set(pageNum, pageInfo.imageData);

            const img = document.createElement('img');
            img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
            img.src = pageInfo.imageData;
            img.alt = `Page ${pageNum + 1} thumbnail`;

            thumbnailContainer.innerHTML = '';
            thumbnailContainer.appendChild(img);
        }
    } catch (error) {
        console.debug(`Thumbnail load failed for page ${pageNum + 1}:`, error);
        const thumbnailContainer = pageItem?.querySelector('.page-thumbnail-container');
        if (thumbnailContainer) {
            thumbnailContainer.innerHTML = '<span style="font-size: 1.5rem;">📄</span>';
        }
    }
}

function displayCachedThumbnail(pageNum, pageItem, activePDF) {
    const thumbnailContainer = pageItem.querySelector('.page-thumbnail-container');
    if (!thumbnailContainer) return;

    const cachedData = activePDF.thumbnails.get(pageNum);
    if (cachedData) {
        const img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
        img.src = cachedData;
        img.alt = `Page ${pageNum + 1} thumbnail`;

        thumbnailContainer.innerHTML = '';
        thumbnailContainer.appendChild(img);
    }
}

/** Cleanup thumbnail loading resources for a tab */
export function cleanupThumbnailLoading(tabId) {
    const abortController = thumbnailAbortControllers.get(tabId);
    if (abortController) {
        abortController.abort();
        thumbnailAbortControllers.delete(tabId);
    }

    const observer = thumbnailObservers.get(tabId);
    if (observer) {
        observer.disconnect();
        thumbnailObservers.delete(tabId);
    }

    thumbnailLoadQueue.delete(tabId);
}

/** Update active thumbnail in sidebar */
export function updateActiveThumbnail(pageNum) {
    document.querySelectorAll('.page-item').forEach((el, idx) => {
        el.classList.toggle('active', idx === pageNum);
    });
}