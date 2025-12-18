let previouslyFocusedElement = null;

/** Returns all focusable elements within a container. */
function getFocusableElements(container) {
    const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');
    
    return Array.from(container.querySelectorAll(focusableSelectors));
}

/** Traps keyboard focus within a modal dialog. */
export function trapFocus(modalElement) {
    const focusableElements = getFocusableElements(modalElement);
    
    if (focusableElements.length === 0) return null;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    // Handle Tab key to trap focus
    const handleTab = (e) => {
        if (e.key !== 'Tab') return;
        
        if (e.shiftKey) {
            // Shift+Tab: move to last element if at first
            if (document.activeElement === firstElement) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab: move to first element if at last
            if (document.activeElement === lastElement) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    };
    
    modalElement.addEventListener('keydown', handleTab);
    
    // Return cleanup function
    return () => {
        modalElement.removeEventListener('keydown', handleTab);
    };
}

/** Releases focus trap by calling the cleanup function. */
export function releaseFocus(cleanupFn) {
    if (cleanupFn && typeof cleanupFn === 'function') {
        cleanupFn();
    }
}

/** Opens a modal with focus management and returns cleanup function. */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    
    // Save current focus
    previouslyFocusedElement = document.activeElement;
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Set up focus trap
    const cleanup = trapFocus(modal);
    
    // Focus first focusable element
    setTimeout(() => {
        const focusableElements = getFocusableElements(modal);
        if (focusableElements.length > 0) {
            // Try to focus first input, otherwise first button
            const firstInput = focusableElements.find(el => 
                el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
            );
            (firstInput || focusableElements[0]).focus();
        }
    }, 100);
    
    return cleanup;
}

/** Closes a modal and restores previous focus. */
export function closeModal(modalId, cleanupFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Hide modal
    modal.classList.add('hidden');
    
    // Clean up focus trap
    if (cleanupFn) {
        cleanupFn();
    }
    
    // Restore previous focus
    if (previouslyFocusedElement && previouslyFocusedElement.focus) {
        previouslyFocusedElement.focus();
    }
    
    previouslyFocusedElement = null;
}

/** Sets up Escape key handler for closing a modal. */
export function setupModalEscapeHandler(modalId, onClose) {
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    
    const handleEscape = (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
            if (!modal.classList.contains('hidden')) {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        }
    };
    
    document.addEventListener('keydown', handleEscape);
    
    // Return cleanup function
    return () => {
        document.removeEventListener('keydown', handleEscape);
    };
}
