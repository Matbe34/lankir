/**
 * Error Recovery Utilities
 * Provides retry mechanisms and error recovery UI
 */

import { showMessage, showConfirm } from './messageDialog.js';

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} options.delayMs - Initial delay in milliseconds (default: 1000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable
 * @returns {Promise} Result of the operation
 */
export async function retryWithBackoff(fn, options = {}) {
    const {
        maxAttempts = 3,
        delayMs = 1000,
        backoffMultiplier = 2,
        shouldRetry = () => true
    } = options;
    
    let lastError;
    let delay = delayMs;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Check if we should retry
            if (attempt >= maxAttempts || !shouldRetry(error)) {
                throw error;
            }
            
            // Wait before retrying
            console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Increase delay for next attempt
            delay *= backoffMultiplier;
        }
    }
    
    throw lastError;
}

/**
 * Show an error dialog with retry option
 * @param {string} message - Error message
 * @param {Function} retryFn - Function to call when user clicks retry
 * @param {string} title - Dialog title
 * @returns {Promise<boolean>} True if user clicked retry, false if cancelled
 */
export async function showErrorWithRetry(message, retryFn, title = 'Error') {
    const userWantsRetry = await showConfirm(
        `${message}\n\nWould you like to try again?`,
        title
    );
    
    if (userWantsRetry && retryFn) {
        try {
            await retryFn();
            return true;
        } catch (error) {
            // If retry also fails, show error without retry option
            await showMessage(
                `Operation failed again: ${error.message}`,
                'Retry Failed',
                'error'
            );
            return false;
        }
    }
    
    return userWantsRetry;
}

/**
 * Wrap an async function with automatic retry on failure
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Retry options (see retryWithBackoff)
 * @returns {Function} Wrapped function
 */
export function withRetry(fn, options = {}) {
    return async function(...args) {
        return retryWithBackoff(() => fn.apply(this, args), options);
    };
}

/**
 * Check if an error is retryable (network, timeout, etc.)
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
export function isRetryableError(error) {
    const retryablePatterns = [
        /network/i,
        /timeout/i,
        /connection/i,
        /ECONNREFUSED/i,
        /ETIMEDOUT/i,
        /temporary/i
    ];
    
    const message = error.message || error.toString();
    return retryablePatterns.some(pattern => pattern.test(message));
}

/**
 * Create a recovery action button in the UI
 * @param {string} containerId - Container element ID
 * @param {string} message - Recovery message
 * @param {Function} action - Action to perform
 */
export function showRecoveryAction(containerId, message, action) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const recoveryDiv = document.createElement('div');
    recoveryDiv.className = 'recovery-action';
    recoveryDiv.style.cssText = `
        margin-top: 1rem;
        padding: 1rem;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        text-align: center;
    `;
    
    const messageP = document.createElement('p');
    messageP.textContent = message;
    messageP.style.marginBottom = '0.75rem';
    
    const button = document.createElement('button');
    button.className = 'btn btn-primary';
    button.textContent = 'Retry';
    button.onclick = async () => {
        button.disabled = true;
        button.textContent = 'Retrying...';
        try {
            await action();
            recoveryDiv.remove();
        } catch (error) {
            button.disabled = false;
            button.textContent = 'Retry';
            await showMessage(
                `Retry failed: ${error.message}`,
                'Error',
                'error'
            );
        }
    };
    
    recoveryDiv.appendChild(messageP);
    recoveryDiv.appendChild(button);
    container.appendChild(recoveryDiv);
}
