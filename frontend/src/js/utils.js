import { getSetting } from './settings.js';

/** Logs messages to console if debug mode is enabled. */
export function debugLog(...args) {
    if (getSetting('debugMode')) {
        console.log(...args);
    }
}

/** Updates the application status bar text. */
export function updateStatus(message) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = message;
    }
}

/** Escapes HTML special characters to prevent XSS. */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Removes internal file paths from error messages. */
export function sanitizeError(error) {
    if (typeof error === 'string') {
        return error;
    }

    if (error && error.message) {
        let message = error.message;

        message = message.replace(/\/[^\s]+\//g, '');
        message = message.replace(/[A-Z]:\\[^\s]+\\/g, '');

        return message;
    }

    return 'An error occurred';
}

/** Formats an ISO date string to localized date/time. */
export function formatDate(isoDateString) {
    try {
        const date = new Date(isoDateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
        return isoDateString;
    }
}

/** Updates all zoom display elements with current level. */
export function updateZoomDisplay(zoomLevel) {
    const zoomDisplay = document.getElementById('zoomDisplay');
    const zoomLevelDisplay = document.getElementById('zoomLevel');
    const zoomInput = document.getElementById('zoomInput');
    const percentage = Math.round(zoomLevel * 100);
    
    if (zoomDisplay) zoomDisplay.textContent = percentage + '%';
    if (zoomLevelDisplay) zoomLevelDisplay.textContent = percentage + '%';
    if (zoomInput) zoomInput.value = percentage;
}

/** Updates the page indicator in the status bar. */
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

/** Updates the scroll progress percentage indicator. */
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

/** Creates a debounced version of a function. */
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
