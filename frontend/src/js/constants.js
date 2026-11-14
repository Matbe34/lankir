// UI Settings
export const UI = {
    LOADING_MIN_DISPLAY_MS: 500,    // Minimum time to show loading indicator
    THUMBNAIL_WIDTH: 48,            // CSS width of recent file thumbnails (a portrait page)
    // Drawn this many times larger and scaled down: at that size pdf.js text comes out as hairlines.
    THUMBNAIL_OVERSAMPLE: 4
};

// File Size Limits
export const LIMITS = {
    MAX_ICON_SIZE_MB: 2,            // Maximum icon file size in MB
    MAX_ICON_SIZE_BYTES: 2 * 1024 * 1024
};

// Settings Validation Ranges
export const SETTINGS = {
    // The Settings dialog's limits; the CLI's config set keeps the same.
    ZOOM: {
        MIN: 10,        // Minimum zoom setting in %
        MAX: 400        // Maximum zoom setting in %
    },
    RECENT_FILES: {
        MIN: 1,         // Minimum number of recent files to list
        MAX: 50         // Maximum number of recent files to list
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
