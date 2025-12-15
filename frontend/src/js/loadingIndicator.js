/**
 * Loading Indicator Utility
 * Shows/hides loading overlays for async operations
 */

let loadingOverlay = null;
let loadingCount = 0;

/**
 * Initialize the loading overlay (called once on app start)
 */
export function initLoadingIndicator() {
    if (loadingOverlay) return;
    
    loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loadingOverlay';
    loadingOverlay.className = 'loading-overlay hidden';
    loadingOverlay.innerHTML = `
        <div class="loading-spinner-container">
            <div class="loading-spinner-large"></div>
            <p class="loading-message" id="loadingMessage">Loading...</p>
        </div>
    `;
    
    document.body.appendChild(loadingOverlay);
    
    // Add CSS if not already present
    if (!document.getElementById('loading-indicator-styles')) {
        const style = document.createElement('style');
        style.id = 'loading-indicator-styles';
        style.textContent = `
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                backdrop-filter: blur(2px);
            }
            
            .loading-overlay.hidden {
                display: none;
            }
            
            .loading-spinner-container {
                background: var(--bg-secondary);
                padding: 2rem;
                border-radius: 0.5rem;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                text-align: center;
            }
            
            .loading-spinner-large {
                width: 48px;
                height: 48px;
                border: 4px solid var(--border-color);
                border-top-color: var(--accent-blue);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 1rem;
            }
            
            .loading-message {
                color: var(--text-primary);
                font-size: 0.875rem;
                margin: 0;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Show loading indicator with optional message
 */
export function showLoading(message = 'Loading...') {
    if (!loadingOverlay) {
        initLoadingIndicator();
    }
    
    loadingCount++;
    
    const messageEl = document.getElementById('loadingMessage');
    if (messageEl && message) {
        messageEl.textContent = message;
    }
    
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-busy', 'true');
    loadingOverlay.setAttribute('aria-label', message);
}

/**
 * Hide loading indicator
 */
export function hideLoading() {
    if (!loadingOverlay) return;
    
    loadingCount = Math.max(0, loadingCount - 1);
    
    // Only hide if no pending operations
    if (loadingCount === 0) {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.removeAttribute('aria-busy');
        loadingOverlay.removeAttribute('aria-label');
    }
}

/**
 * Wrap an async function to show loading indicator
 */
export function withLoading(asyncFn, message = 'Loading...', minDisplayTime = 500) {
    return async function(...args) {
        showLoading(message);
        const startTime = Date.now();
        
        try {
            const result = await asyncFn.apply(this, args);
            
            // Ensure loading indicator is shown for at least minDisplayTime
            const elapsed = Date.now() - startTime;
            if (elapsed < minDisplayTime) {
                await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
            }
            
            return result;
        } finally {
            hideLoading();
        }
    };
}
