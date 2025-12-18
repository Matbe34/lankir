import { showMessage, showConfirm } from './messageDialog.js';

/** Retries an async operation with exponential backoff. */
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

/** Shows an error dialog with retry option, returns true if retried. */
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

/** Wraps an async function with automatic retry on failure. */
export function withRetry(fn, options = {}) {
    return async function(...args) {
        return retryWithBackoff(() => fn.apply(this, args), options);
    };
}

/** Checks if an error is retryable (network, timeout, etc.). */
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

/** Creates a recovery action button in the UI. */
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
