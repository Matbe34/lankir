# Wails Integration

Lankir uses Wails v2 to bridge the Go backend with the web-based frontend.

## How Wails Works

Wails embeds a WebView and runs Go code in the same process:

```
┌────────────────────────────────────────┐
│              Lankir Process            │
│  ┌──────────────┐  ┌────────────────┐  │
│  │   Go Code    │  │    WebView     │  │
│  │              │  │                │  │
│  │  Services ◄──┼──┼── JavaScript  │  │
│  │              │  │                │  │
│  └──────────────┘  └────────────────┘  │
└────────────────────────────────────────┘
```

Communication happens through:
1. **Method bindings**: JS calls Go functions
2. **Events**: Go emits events to JS
3. **Runtime**: Window controls, dialogs

## Service Binding

### Registering Services

```go
// main.go
err = wails.Run(&options.App{
    Title:  "Lankir",
    Width:  1400,
    Height: 900,
    
    OnStartup: func(ctx context.Context) {
        app.startup(ctx)
        pdfService.Startup(ctx)
        signatureService.Startup(ctx)
    },
    
    Bind: []interface{}{
        app,
        pdfService,
        signatureService,
        configService,
    },
})
```

### Generated Bindings

Wails generates JavaScript bindings in `frontend/wailsjs/go/`:

```
frontend/wailsjs/go/
├── main/
│   └── App.js              # App service bindings
├── pdf/
│   ├── PDFService.js       # PDF service bindings
│   └── PDFService.d.ts     # TypeScript definitions
├── signature/
│   └── SignatureService.js
└── config/
    └── Service.js
```

### Binding Example

**Go method:**
```go
// internal/pdf/service.go
func (s *PDFService) OpenPDFByPath(path string) (*PDFMetadata, error) {
    // ... implementation
    return &PDFMetadata{
        FilePath:  path,
        PageCount: doc.NumPage(),
        Title:     doc.Metadata()["title"],
    }, nil
}
```

**Generated JavaScript:**
```javascript
// frontend/wailsjs/go/pdf/PDFService.js
export function OpenPDFByPath(arg1) {
    return window['go']['pdf']['PDFService']['OpenPDFByPath'](arg1);
}
```

**Generated TypeScript definitions:**
```typescript
// frontend/wailsjs/go/pdf/PDFService.d.ts
export function OpenPDFByPath(arg1:string):Promise<pdf.PDFMetadata>;
```

## Using Bindings in Frontend

### Importing

```javascript
// Import specific service
import { PDFService } from '../wailsjs/go/pdf/PDFService.js';
import { SignatureService } from '../wailsjs/go/signature/SignatureService.js';
import { Service as ConfigService } from '../wailsjs/go/config/Service.js';

// Import runtime functions
import * as runtime from '../wailsjs/runtime/runtime.js';
```

### Calling Methods

All bound methods return Promises:

```javascript
// Simple call
async function loadPDF(path) {
    const metadata = await PDFService.OpenPDFByPath(path);
    console.log(`Loaded ${metadata.PageCount} pages`);
}

// With error handling
async function signDocument(pdfPath, certFingerprint, pin) {
    try {
        const result = await SignatureService.SignPDF(pdfPath, certFingerprint, pin);
        showSuccess(`Signed: ${result}`);
    } catch (error) {
        showError(`Signing failed: ${error}`);
    }
}
```

### Handling Return Types

Go structs become JavaScript objects:

```go
// Go
type Certificate struct {
    Name        string   `json:"name"`
    Fingerprint string   `json:"fingerprint"`
    IsValid     bool     `json:"isValid"`
}
```

```javascript
// JavaScript
const certs = await SignatureService.ListCertificates();
certs.forEach(cert => {
    console.log(cert.name);        // string
    console.log(cert.fingerprint); // string
    console.log(cert.isValid);     // boolean
});
```

## Wails Runtime

### Window Control

```javascript
import { 
    WindowMinimise, 
    WindowMaximise, 
    WindowToggleMaximise,
    Quit 
} from '../wailsjs/runtime/runtime.js';

// Window controls
document.getElementById('btn-minimize').onclick = WindowMinimise;
document.getElementById('btn-maximize').onclick = WindowToggleMaximise;
document.getElementById('btn-close').onclick = Quit;
```

### System Dialogs

The `App` service wraps Wails runtime dialogs:

```go
// app.go
func (a *App) OpenFileDialog() (string, error) {
    return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
        Title: "Open PDF",
        Filters: []runtime.FileFilter{
            {DisplayName: "PDF Files", Pattern: "*.pdf"},
        },
    })
}
```

```javascript
// Frontend
const filePath = await App.OpenFileDialog();
if (filePath) {
    await PDFService.OpenPDFByPath(filePath);
}
```

### Events

**Go emitting events:**
```go
runtime.EventsEmit(s.ctx, "pdf:progress", progress)
```

**JavaScript listening:**
```javascript
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime.js';

// Subscribe
EventsOn("pdf:progress", (progress) => {
    updateProgressBar(progress);
});

// Unsubscribe
EventsOff("pdf:progress");
```

## Context Handling

### Startup Context

Every service receives the Wails context in `Startup`:

```go
type SignatureService struct {
    ctx context.Context  // Stored for later use
}

func (s *SignatureService) Startup(ctx context.Context) {
    s.ctx = ctx
}
```

The context is used for:
- Emitting events to frontend
- Opening dialogs
- Accessing runtime functions

### Using Context

```go
func (s *SignatureService) SignPDF(...) (string, error) {
    // Emit progress events
    runtime.EventsEmit(s.ctx, "sign:start", pdfPath)
    
    // ... signing logic ...
    
    runtime.EventsEmit(s.ctx, "sign:complete", outputPath)
    return outputPath, nil
}
```

## Asset Embedding

Frontend assets are embedded in the binary:

```go
//go:embed all:frontend/dist
var assets embed.FS

err = wails.Run(&options.App{
    AssetServer: &assetserver.Options{
        Assets: assets,
    },
})
```

The `frontend/dist` directory is included at compile time.

## Build Process

### Development Mode

```bash
wails dev
```

- Hot reload for frontend changes
- Rebuilds Go on changes
- Opens browser DevTools

### Production Build

```bash
wails build
```

- Compiles Go with frontend embedded
- Optimizes assets
- Produces single binary

## Regenerating Bindings

Bindings are auto-generated when you run `wails dev` or `wails build`.

To manually regenerate:

```bash
wails generate module
```

## Common Patterns

### Loading State

```javascript
async function loadWithSpinner(asyncFn) {
    showLoading();
    try {
        return await asyncFn();
    } finally {
        hideLoading();
    }
}

// Usage
const metadata = await loadWithSpinner(() => 
    PDFService.OpenPDFByPath(path)
);
```

### Error Boundary

```javascript
async function safeCall(fn, errorMessage) {
    try {
        return await fn();
    } catch (error) {
        console.error(errorMessage, error);
        showToast(errorMessage, 'error');
        throw error;
    }
}

// Usage
await safeCall(
    () => SignatureService.SignPDF(path, cert, pin),
    'Failed to sign document'
);
```

### Progress Tracking

```javascript
// Set up listener before operation
EventsOn("sign:progress", updateProgress);

try {
    await SignatureService.SignPDF(...);
} finally {
    EventsOff("sign:progress");
}
```

## Debugging

### DevTools

In development mode, open browser DevTools with F12.

### Go Logging

```go
import "log/slog"

slog.Info("Processing PDF", "path", pdfPath)
slog.Error("Signing failed", "error", err)
```

### Frontend Logging

```javascript
console.log("Calling backend...");
const result = await SomeService.Method();
console.log("Result:", result);
```

## Next Steps

- [Development Setup](../development/setup.md)
- [Building](../development/building.md)
- [Backend Architecture](backend.md)
