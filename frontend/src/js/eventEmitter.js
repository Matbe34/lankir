/**
 * Simple Event Emitter for State Management
 * Provides pub/sub pattern for state changes
 */

class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
        
        // Return unsubscribe function
        return () => {
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        };
    }
    
    /**
     * Subscribe to an event once
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    once(event, callback) {
        const unsubscribe = this.on(event, (...args) => {
            callback(...args);
            unsubscribe();
        });
    }
    
    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to callbacks
     */
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in event listener for "${event}":`, error);
                }
            });
        }
    }
    
    /**
     * Remove all listeners for an event
     * @param {string} event - Event name
     */
    off(event) {
        delete this.events[event];
    }
}

// Global event emitter for state changes
export const stateEmitter = new EventEmitter();

// State change events
export const StateEvents = {
    PDF_OPENED: 'pdf:opened',
    PDF_CLOSED: 'pdf:closed',
    TAB_SWITCHED: 'tab:switched',
    ZOOM_CHANGED: 'zoom:changed',
    PAGE_CHANGED: 'page:changed',
    SETTINGS_CHANGED: 'settings:changed',
    CERTIFICATE_SELECTED: 'certificate:selected',
    SIGNATURE_ADDED: 'signature:added'
};
