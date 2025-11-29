import { state, setZoomLevel, getActivePDF } from './state.js';
import { updateZoomDisplay } from './utils.js';


export function changeZoom(delta) {
    const newZoom = Math.max(0.1, Math.min(3.0, state.zoomLevel + delta));
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

export function setZoomFromInput(value) {
    const percentage = parseInt(value);
    if (isNaN(percentage) || percentage < 10 || percentage > 300) {
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

export function updateZoomControls() {
    updateZoomDisplay(state.zoomLevel);
}
