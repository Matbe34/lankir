/**
 * Application Constants
 * Centralized location for all magic numbers and configuration values
 */

// Zoom Configuration
export const ZOOM = {
    MIN: 0.1,           // Minimum zoom level (10%)
    MAX: 3.0,           // Maximum zoom level (300%)
    DEFAULT: 1.0,       // Default zoom level (100%)
    STEP: 0.1,          // Zoom step increment (10%)
    THROTTLE_MS: 100    // Throttle delay for zoom wheel events
};

// PDF Page Configuration
export const PDF_PAGE = {
    A4_WIDTH: 794,      // A4 page width in points
    A4_HEIGHT: 1123,    // A4 page height in points (actually closer to 842, but this is used as fallback)
    DEFAULT_WIDTH: 794,
    DEFAULT_HEIGHT: 1123
};

// DPI Settings
export const DPI = {
    SCREEN: 96,         // Standard screen DPI
    RENDER: 150,        // PDF rendering DPI (higher = better quality but slower)
    SCALE: 96 / 150     // Scale factor between screen and render DPI
};

// Performance Settings
export const PERFORMANCE = {
    LAZY_LOAD_BUFFER_PX: 1000,      // Pixels above/below viewport to preload
    LAZY_LOAD_DEBOUNCE_MS: 100,     // Debounce delay for scroll events
    BACKGROUND_LOAD_BATCH_SIZE: 3,   // Pages to load before yielding to UI
    BACKGROUND_LOAD_DELAY_MS: 10,    // Delay between background load batches
    DEBOUNCE_DEFAULT_MS: 100         // Default debounce delay
};

// UI Settings
export const UI = {
    LOADING_MIN_DISPLAY_MS: 500,    // Minimum time to show loading indicator
    THUMBNAIL_WIDTH: 400            // Width for recent file thumbnails
};

// File Size Limits
export const LIMITS = {
    MAX_ICON_SIZE_MB: 2,            // Maximum icon file size in MB
    MAX_ICON_SIZE_BYTES: 2 * 1024 * 1024
};

// Settings Validation Ranges
export const SETTINGS = {
    ZOOM: {
        MIN: 10,        // Minimum zoom setting in %
        MAX: 500        // Maximum zoom setting in %
    },
    RECENT_FILES: {
        MIN: 0,         // Minimum number of recent files to track
        MAX: 100        // Maximum number of recent files to track
    },
    AUTOSAVE: {
        MIN: 0,         // Minimum autosave interval in seconds (0 = disabled)
        MAX: 3600       // Maximum autosave interval in seconds (1 hour)
    }
};

// Signature Validation
export const SIGNATURE = {
    MIN_WIDTH: 50,      // Minimum signature width in points
    MAX_WIDTH: 400,     // Maximum signature width in points
    MIN_HEIGHT: 30,     // Minimum signature height in points
    MAX_HEIGHT: 200     // Maximum signature height in points
};

// Storage Keys
export const STORAGE_KEYS = {
    SETTINGS: 'pdfEditorSettings',
    CACHE_PREFIX: 'cache_'
};

// Cache Expiration
export const CACHE = {
    EXPIRATION_DAYS: 7,             // Days before cached data expires
    EXPIRATION_MS: 7 * 24 * 60 * 60 * 1000
};
