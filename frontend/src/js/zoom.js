// Zoom Module
// Handles zoom functionality for PDF viewing

import { state, setZoomLevel } from './state.js';
import { updateZoomDisplay } from './utils.js';

/**
 * Change zoom level by delta
 */
export function changeZoom(delta) {
    const newZoom = Math.max(0.5, Math.min(3.0, state.zoomLevel + delta));
    setZoomLevel(newZoom);
    updateZoomDisplay(newZoom);
    
    // Re-render current view with new zoom
    const containers = document.querySelectorAll('.pdf-page-container');
    if (containers.length > 0) {
        containers.forEach(container => {
            container.style.transform = `scale(${newZoom})`;
        });
    }
}

/**
 * Set zoom level from input value
 */
export function setZoomFromInput(value) {
    const percentage = parseInt(value);
    if (isNaN(percentage) || percentage < 50 || percentage > 300) {
        // Reset to current value if invalid
        updateZoomDisplay(state.zoomLevel);
        return;
    }
    
    const newZoom = percentage / 100;
    setZoomLevel(newZoom);
    updateZoomDisplay(newZoom);
    
    // Re-render current view with new zoom
    const containers = document.querySelectorAll('.pdf-page-container');
    if (containers.length > 0) {
        containers.forEach(container => {
            container.style.transform = `scale(${newZoom})`;
        });
    }
}

/**
 * Update zoom controls in UI
 */
export function updateZoomControls() {
    updateZoomDisplay(state.zoomLevel);
}
