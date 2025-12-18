import { state, setZoomLevel, getActivePDF } from './state.js';
import { updateZoomDisplay } from './utils.js';
import { ZOOM } from './constants.js';

/** Adjusts zoom level by delta and updates all PDF page containers. */
export function changeZoom(delta) {
    const newZoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, state.zoomLevel + delta));
    state.zoomLevel = newZoom;

    const activePDF = getActivePDF();
    if (activePDF) {
        activePDF.zoomLevel = newZoom;
    }

    updateZoomDisplay(newZoom);

    const containers = document.querySelectorAll('.pdf-page-container');
    if (containers.length > 0) {
        containers.forEach(container => {
            const originalWidth = parseFloat(container.dataset.width);
            const originalHeight = parseFloat(container.dataset.height);

            if (!isNaN(originalWidth) && !isNaN(originalHeight)) {
                container.style.width = `${originalWidth * newZoom}px`;
                container.style.height = `${originalHeight * newZoom}px`;
                container.style.transform = 'none';
            } else {
                container.style.transform = `scale(${newZoom})`;
            }
        });
    }
}

/** Sets zoom level from percentage input value (e.g., "150" for 150%). */
export function setZoomFromInput(value) {
    const percentage = parseInt(value);
    if (isNaN(percentage) || percentage < ZOOM.MIN * 100 || percentage > ZOOM.MAX * 100) {
        updateZoomDisplay(state.zoomLevel);
        return;
    }

    const newZoom = percentage / 100;
    state.zoomLevel = newZoom;

    const activePDF = getActivePDF();
    if (activePDF) {
        activePDF.zoomLevel = newZoom;
    }

    updateZoomDisplay(newZoom);

    const containers = document.querySelectorAll('.pdf-page-container');
    if (containers.length > 0) {
        containers.forEach(container => {
            const originalWidth = parseFloat(container.dataset.width);
            const originalHeight = parseFloat(container.dataset.height);

            if (!isNaN(originalWidth) && !isNaN(originalHeight)) {
                container.style.width = `${originalWidth * newZoom}px`;
                container.style.height = `${originalHeight * newZoom}px`;
                container.style.transform = 'none';
            } else {
                container.style.transform = `scale(${newZoom})`;
            }
        });
    }
}

/** Updates the zoom display input to reflect current zoom level. */
export function updateZoomControls() {
    updateZoomDisplay(state.zoomLevel);
}
