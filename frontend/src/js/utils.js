// Utility Functions

export function updateStatus(message) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = message;
    }
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatDate(isoDateString) {
    try {
        const date = new Date(isoDateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
        return isoDateString;
    }
}

export function updateZoomDisplay(zoomLevel) {
    const zoomDisplay = document.getElementById('zoomDisplay');
    const zoomLevelDisplay = document.getElementById('zoomLevel');
    const zoomInput = document.getElementById('zoomInput');
    const percentage = Math.round(zoomLevel * 100);
    
    if (zoomDisplay) zoomDisplay.textContent = percentage + '%';
    if (zoomLevelDisplay) zoomLevelDisplay.textContent = percentage + '%';
    if (zoomInput) zoomInput.value = percentage;
}

export function updatePageIndicator(currentPage, totalPages) {
    const pageIndicator = document.getElementById('pageIndicator');
    if (pageIndicator) {
        if (currentPage && totalPages) {
            pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        } else {
            pageIndicator.textContent = '-';
        }
    }
}

export function updateScrollProgress(percentage) {
    const scrollProgress = document.getElementById('scrollProgress');
    if (scrollProgress) {
        if (percentage !== null && percentage !== undefined) {
            scrollProgress.textContent = `${Math.round(percentage)}% `;
        } else {
            scrollProgress.textContent = '-';
        }
    }
}

// Debounce function for performance
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
