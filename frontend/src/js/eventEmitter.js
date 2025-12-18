/** Simple pub/sub event emitter for state management. */
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    /** Subscribes to an event and returns unsubscribe function. */
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
    
    /** Subscribes to an event for a single invocation. */
    once(event, callback) {
        const unsubscribe = this.on(event, (...args) => {
            callback(...args);
            unsubscribe();
        });
    }
    
    /** Emits an event to all subscribers. */
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
    
    /** Removes all listeners for an event. */
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
