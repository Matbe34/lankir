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

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

/** Escapes text for HTML, in content or a quoted attribute alike. */
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
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

/** Updates the go-to-page input and page total in the status bar. */
export function updatePageIndicator(currentPage, totalPages) {
    const input = document.getElementById('pageInput');
    const total = document.getElementById('pageTotal');
    const known = Boolean(currentPage && totalPages);
    if (input) {
        input.value = known ? String(currentPage) : '';
        input.disabled = !known;
        input.max = known ? String(totalPages) : '';
    }
    if (total) total.textContent = `/ ${known ? totalPages : '-'}`;
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

/** "512 bytes", "24.8 KB", "1.2 MB", "118 MB"; empty when the size is unknown. */
export function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} bytes`;
    const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / (1024 * 1024), 'MB'];
    return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
