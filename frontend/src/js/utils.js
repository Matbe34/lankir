// Utility Functions

import { getSetting } from './settings.js';

/**
 * Log debug messages if debug mode is enabled
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (getSetting('debugMode')) {
        console.log(...args);
    }
}

/**
 * Update the application status bar with a message
 * @param {string} message - Status message to display
 */
export function updateStatus(message) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = message;
    }
}

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} HTML-safe escaped text
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitize error messages by removing internal file paths
 * @param {Error|string} error - Error object or message
 * @returns {string} Sanitized error message safe for display
 */
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

/**
 * Format an ISO date string to localized date/time
 * @param {string} isoDateString - ISO 8601 date string
 * @returns {string} Formatted date string
 */
export function formatDate(isoDateString) {
    try {
        const date = new Date(isoDateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
        return isoDateString;
    }
}

/**
 * Update all zoom display elements with current zoom level
 * @param {number} zoomLevel - Zoom level as decimal (1.0 = 100%)
 */
export function updateZoomDisplay(zoomLevel) {
    const zoomDisplay = document.getElementById('zoomDisplay');
    const zoomLevelDisplay = document.getElementById('zoomLevel');
    const zoomInput = document.getElementById('zoomInput');
    const percentage = Math.round(zoomLevel * 100);
    
    if (zoomDisplay) zoomDisplay.textContent = percentage + '%';
    if (zoomLevelDisplay) zoomLevelDisplay.textContent = percentage + '%';
    if (zoomInput) zoomInput.value = percentage;
}

/**
 * Update the page indicator in the status bar
 * @param {number|null} currentPage - Current page number (1-indexed)
 * @param {number|null} totalPages - Total number of pages
 */
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

/**
 * Update the scroll progress indicator
 * @param {number|null} percentage - Scroll position as percentage (0-100)
 */
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

/**
 * Debounce a function to prevent excessive calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait before calling
 * @returns {Function} Debounced function
 */
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
