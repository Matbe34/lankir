/**
 * Modal Dialog Base Class
 * Standardizes modal/dialog behavior across the application
 */

import { trapFocus, releaseFocus } from './focusManager.js';

export class Modal {
    constructor(modalId, options = {}) {
        this.modalId = modalId;
        this.modal = document.getElementById(modalId);
        
        if (!this.modal) {
            console.error(`Modal element not found: ${modalId}`);
            return;
        }

        this.options = {
            closeOnEscape: true,
            closeOnBackdrop: false,
            trapFocus: true,
            onOpen: null,
            onClose: null,
            ...options
        };

        this.focusCleanup = null;
        this.isOpen = false;
        
        this.setupEventHandlers();
    }

    /**
     * Setup close button and keyboard handlers
     */
    setupEventHandlers() {
        // Find close buttons (by class or data attribute)
        const closeButtons = this.modal.querySelectorAll('[data-close-modal], .modal-close, .dialog-close');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        });

        // Backdrop click
        if (this.options.closeOnBackdrop) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.close();
                }
            });
        }

        // Escape key
        if (this.options.closeOnEscape) {
            this.escapeHandler = (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    e.preventDefault();
                    this.close();
                }
            };
            document.addEventListener('keydown', this.escapeHandler);
        }
    }

    /**
     * Open the modal
     */
    open() {
        if (this.isOpen) return;
        
        this.modal.classList.remove('hidden');
        this.isOpen = true;

        // Trap focus if enabled
        if (this.options.trapFocus) {
            this.focusCleanup = trapFocus(this.modal);
        }

        // Call onOpen callback
        if (this.options.onOpen) {
            this.options.onOpen();
        }

        // Emit custom event
        this.modal.dispatchEvent(new CustomEvent('modal:opened', {
            detail: { modalId: this.modalId }
        }));
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.isOpen) return;

        this.modal.classList.add('hidden');
        this.isOpen = false;

        // Release focus trap
        if (this.focusCleanup) {
            releaseFocus(this.focusCleanup);
            this.focusCleanup = null;
        }

        // Call onClose callback
        if (this.options.onClose) {
            this.options.onClose();
        }

        // Emit custom event
        this.modal.dispatchEvent(new CustomEvent('modal:closed', {
            detail: { modalId: this.modalId }
        }));
    }

    /**
     * Toggle modal state
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Destroy modal and cleanup
     */
    destroy() {
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
        }
        
        if (this.focusCleanup) {
            releaseFocus(this.focusCleanup);
        }
        
        this.isOpen = false;
    }
}

/**
 * Confirmation Modal - extends base Modal with OK/Cancel buttons
 */
export class ConfirmModal extends Modal {
    constructor(modalId, options = {}) {
        super(modalId, {
            ...options,
            closeOnEscape: true,
            closeOnBackdrop: false
        });

        this.resolveCallback = null;
        this.setupConfirmHandlers();
    }

    setupConfirmHandlers() {
        // Find OK/Confirm button
        const confirmBtn = this.modal.querySelector('[data-confirm], .modal-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.confirm();
            });
        }

        // Find Cancel button
        const cancelBtn = this.modal.querySelector('[data-cancel], .modal-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.cancel();
            });
        }
    }

    /**
     * Show modal and return promise that resolves on confirm/cancel
     */
    show() {
        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.open();
        });
    }

    /**
     * User confirmed
     */
    confirm() {
        if (this.resolveCallback) {
            this.resolveCallback(true);
            this.resolveCallback = null;
        }
        this.close();
    }

    /**
     * User cancelled
     */
    cancel() {
        if (this.resolveCallback) {
            this.resolveCallback(false);
            this.resolveCallback = null;
        }
        this.close();
    }

    /**
     * Override close to handle promise rejection
     */
    close() {
        if (this.resolveCallback) {
            this.resolveCallback(false);
            this.resolveCallback = null;
        }
        super.close();
    }
}

/**
 * Factory function to create modals easily
 */
export function createModal(modalId, options = {}) {
    const type = options.type || 'basic';
    
    if (type === 'confirm') {
        return new ConfirmModal(modalId, options);
    }
    
    return new Modal(modalId, options);
}
