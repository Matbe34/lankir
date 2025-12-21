# Frontend Architecture

The frontend is built with vanilla JavaScript using ES6 modules—no framework, no bundler.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | JavaScript (ES6+) |
| Styling | Tailwind CSS |
| Build | Shell script (CSS compilation only) |
| Communication | Wails runtime bindings |

## Module Structure

```
frontend/src/js/
├── app.js              # Application entry point
├── state.js            # Global state management
├── eventEmitter.js     # Event bus for decoupling
├── constants.js        # Application constants
├── utils.js            # Utility functions
│
├── pdfManager.js       # PDF loading/caching
├── pageLoader.js       # Page rendering pipeline
├── renderer.js         # Canvas rendering
│
├── ui.js               # UI updates
├── modal.js            # Modal dialogs
├── messageDialog.js    # Toast messages
├── loadingIndicator.js # Loading states
│
├── certificates.js     # Certificate UI
├── certificateRenderer.js # Certificate display
├── signature.js        # Signing UI
├── signatureProfiles.js # Profile management
│
├── settings.js         # Settings panel
├── themeManager.js     # Theme handling
├── recentFiles.js      # Recent files
├── zoom.js             # Zoom controls
├── focusManager.js     # Keyboard focus
├── pdfOperations.js    # PDF actions
└── errorRecovery.js    # Error handling
```

## Entry Point

```javascript
// app.js
import { initializeApp } from './state.js';
import { setupEventListeners } from './ui.js';
import { initTheme } from './themeManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await initializeApp();
    setupEventListeners();
});
```

## State Management

Centralized state in `state.js`:

```javascript
// state.js
let state = {
    currentPDF: null,
    pageCount: 0,
    currentPage: 1,
    zoom: 100,
    isLoading: false
};

export function getState() {
    return { ...state };
}

export function setState(updates) {
    state = { ...state, ...updates };
    eventEmitter.emit('stateChanged', state);
}
```

## Event System

Decoupled communication via events:

```javascript
// eventEmitter.js
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    on(event, callback) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
    }
    
    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach(cb => cb(data));
        }
    }
    
    off(event, callback) {
        if (this.events[event]) {
            this.events[event] = this.events[event]
                .filter(cb => cb !== callback);
        }
    }
}

export const eventEmitter = new EventEmitter();
```

## Wails Integration

### Importing Services

```javascript
// Auto-generated bindings
import { PDFService } from '../wailsjs/go/pdf/PDFService.js';
import { SignatureService } from '../wailsjs/go/signature/SignatureService.js';
import * as runtime from '../wailsjs/runtime/runtime.js';
```

### Calling Backend

```javascript
// All calls return Promises
async function openPDF() {
    try {
        const metadata = await PDFService.OpenPDF();
        setState({ currentPDF: metadata });
    } catch (error) {
        showError('Failed to open PDF', error);
    }
}
```

### Runtime Functions

```javascript
import { EventsOn, EventsOff, Quit } from '../wailsjs/runtime/runtime.js';

// Listen for backend events
EventsOn('pdf:loaded', (data) => {
    console.log('PDF loaded:', data);
});

// Window controls
runtime.WindowMinimise();
runtime.WindowMaximise();
```

## PDF Rendering Pipeline

### Page Loading

```javascript
// pageLoader.js
export async function loadPage(pageNumber, zoom) {
    const cacheKey = `${pageNumber}-${zoom}`;
    
    if (pageCache.has(cacheKey)) {
        return pageCache.get(cacheKey);
    }
    
    const imageData = await PDFService.RenderPage(pageNumber, zoom);
    pageCache.set(cacheKey, imageData);
    
    return imageData;
}
```

### Canvas Rendering

```javascript
// renderer.js
export function renderPage(canvas, imageData) {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    
    img.src = `data:image/png;base64,${imageData}`;
}
```

## UI Components

### Modal Pattern

```javascript
// modal.js
export function showModal(options) {
    const { title, content, onConfirm, onCancel } = options;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>${escapeHtml(title)}</h2>
            <div>${content}</div>
            <div class="modal-buttons">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-confirm">Confirm</button>
            </div>
        </div>
    `;
    
    // Event handlers...
    document.body.appendChild(modal);
}
```

### Toast Messages

```javascript
// messageDialog.js
export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}
```

## Security Considerations

### XSS Prevention

Always escape user input:

```javascript
// utils.js
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Usage
element.innerHTML = `<span>${escapeHtml(userInput)}</span>`;
```

### Input Validation

```javascript
// signature.js
function validateCoordinates(x, y, width, height) {
    const MAX_COORD = 10000;
    const MAX_SIZE = 2000;
    
    if (x < 0 || x > MAX_COORD) return false;
    if (y < 0 || y > MAX_COORD) return false;
    if (width <= 0 || width > MAX_SIZE) return false;
    if (height <= 0 || height > MAX_SIZE) return false;
    
    return true;
}
```

## Error Handling

### Global Handler

```javascript
// errorRecovery.js
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showToast('An error occurred', 'error');
});
```

### Service Errors

```javascript
async function loadCertificates() {
    try {
        const certs = await SignatureService.ListCertificates();
        renderCertificates(certs);
    } catch (error) {
        console.error('Certificate loading failed:', error);
        showError('Could not load certificates');
    }
}
```

## Build Process

```bash
# frontend/build.sh
#!/bin/bash

# Compile Tailwind CSS
npx tailwindcss -i ./src/style.css -o ./dist/style.css --minify

# Copy files to dist
cp src/index.html dist/
cp -r src/js dist/
```

No JavaScript bundling—modules loaded natively.

## Testing

Tests use Vitest:

```javascript
// tests/utils.test.js
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/js/utils.js';

describe('escapeHtml', () => {
    it('escapes HTML entities', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });
});
```

Run tests:
```bash
cd frontend && npm test
```

## Next Steps

- [Signature System](signature-system.md)
- [Wails Integration](wails-integration.md)
- [Development Setup](../development/setup.md)
