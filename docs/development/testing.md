# Testing

PDF App uses Go's standard testing package for backend tests and Vitest for frontend tests.

## Running Tests

### All Tests

```bash
# Run all Go tests
task test

# With verbose output
go test -v ./...
```

### With Coverage

```bash
# Generate coverage report
task test-coverage

# Opens coverage.html in browser
```

### Specific Package

```bash
# Test specific package
go test ./internal/pdf/...
go test ./internal/signature/...

# Single test file
go test ./internal/pdf/service_test.go
```

## Backend Tests

### Test Structure

Each package has `*_test.go` files alongside source files:

```
internal/
├── config/
│   ├── config.go
│   └── config_test.go
├── pdf/
│   ├── service.go
│   ├── service_test.go
│   ├── recent.go
│   ├── recent_test.go
│   └── testhelpers_test.go
└── signature/
    ├── service.go
    ├── service_test.go
    ├── profile.go
    └── profile_test.go
```

### Test Helpers

Common test utilities in `testhelpers_test.go`:

```go
// internal/pdf/testhelpers_test.go
func CreateTestPDF(t *testing.T) string {
    // Creates a temporary PDF for testing
    // Returns path to the file
}

func CleanupTestFiles(t *testing.T, paths ...string) {
    // Removes test files after test
}
```

### Example Test

```go
// internal/config/config_test.go
func TestConfigService(t *testing.T) {
    // Create temp directory
    tmpDir := t.TempDir()
    
    // Create service with test directory
    service, err := NewServiceWithDir(tmpDir)
    if err != nil {
        t.Fatalf("failed to create service: %v", err)
    }
    
    // Test default values
    cfg := service.Get()
    if cfg.Theme != "dark" {
        t.Errorf("expected theme 'dark', got '%s'", cfg.Theme)
    }
}
```

### Table-Driven Tests

```go
// internal/signature/profile_test.go
func TestValidateProfile(t *testing.T) {
    tests := []struct {
        name    string
        profile *SignatureProfile
        wantErr bool
    }{
        {
            name: "valid invisible profile",
            profile: &SignatureProfile{
                ID:         uuid.New(),
                Name:       "Test",
                Visibility: VisibilityInvisible,
            },
            wantErr: false,
        },
        {
            name: "missing name",
            profile: &SignatureProfile{
                ID:         uuid.New(),
                Visibility: VisibilityInvisible,
            },
            wantErr: true,
        },
        // More test cases...
    }
    
    pm := NewProfileManagerWithDir(t.TempDir())
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := pm.ValidateProfile(tt.profile)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateProfile() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### Test Data

Test fixtures in `testdata/` directories:

```
internal/signature/testdata/
├── test.p12           # Test certificate
├── sample.pdf         # Test PDF
└── signed.pdf         # Pre-signed PDF
```

Access in tests:

```go
func TestWithTestData(t *testing.T) {
    testPDF := filepath.Join("testdata", "sample.pdf")
    // Use testPDF...
}
```

## Frontend Tests

### Running Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Test Structure

```
frontend/tests/
├── setup.js              # Test setup
├── utils.test.js         # Utils tests
├── state.test.js         # State tests
├── eventEmitter.test.js  # Event tests
├── security.test.js      # Security tests
├── memoryLeaks.test.js   # Memory tests
└── integration.test.js   # Integration tests
```

### Example Frontend Test

```javascript
// tests/utils.test.js
import { describe, it, expect } from 'vitest';
import { escapeHtml, debounce } from '../src/js/utils.js';

describe('escapeHtml', () => {
    it('escapes HTML entities', () => {
        expect(escapeHtml('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });
    
    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });
    
    it('handles null/undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });
});

describe('debounce', () => {
    it('delays function execution', async () => {
        let count = 0;
        const fn = debounce(() => count++, 50);
        
        fn();
        fn();
        fn();
        
        expect(count).toBe(0);
        
        await new Promise(r => setTimeout(r, 100));
        expect(count).toBe(1);
    });
});
```

### Mocking Wails Bindings

```javascript
// tests/setup.js
import { vi } from 'vitest';

// Mock Wails runtime
globalThis.window = {
    go: {
        pdf: {
            PDFService: {
                OpenPDF: vi.fn().mockResolvedValue({ pageCount: 10 }),
                RenderPage: vi.fn().mockResolvedValue('base64data'),
            }
        }
    }
};
```

## Coverage Reports

### Go Coverage

```bash
# Generate coverage
go test -coverprofile=coverage.out ./...

# View in terminal
go tool cover -func=coverage.out

# Generate HTML report
go tool cover -html=coverage.out -o coverage.html
```

### Frontend Coverage

```bash
cd frontend
npm run test:coverage

# Report in frontend/coverage/
```

### Coverage Goals

| Package | Target |
|---------|--------|
| internal/config | 80%+ |
| internal/pdf | 70%+ |
| internal/signature | 70%+ |
| frontend/js | 60%+ |

## Integration Tests

### Backend Integration

```go
// internal/signature/service_test.go
func TestSigningWorkflow(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }
    
    // Create services
    cfgService, _ := config.NewServiceWithDir(t.TempDir())
    sigService := NewSignatureService(cfgService)
    sigService.Startup(context.Background())
    
    // Create test PDF
    pdfPath := createTestPDF(t)
    
    // Sign PDF
    signedPath, err := sigService.SignPDF(pdfPath, testCertFingerprint, testPIN)
    if err != nil {
        t.Fatalf("signing failed: %v", err)
    }
    
    // Verify signature
    sigs, err := sigService.VerifySignatures(signedPath)
    if err != nil {
        t.Fatalf("verification failed: %v", err)
    }
    
    if len(sigs) != 1 {
        t.Errorf("expected 1 signature, got %d", len(sigs))
    }
}
```

### Frontend Integration

```javascript
// tests/integration.test.js
describe('PDF Loading Integration', () => {
    it('loads PDF and updates state', async () => {
        const { loadPDF, getState } = await import('../src/js/app.js');
        
        await loadPDF('/path/to/test.pdf');
        
        const state = getState();
        expect(state.currentPDF).toBeDefined();
        expect(state.pageCount).toBeGreaterThan(0);
    });
});
```

## Continuous Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test-go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      
      - name: Install dependencies
        run: sudo apt install libnss3-dev
      
      - name: Run tests
        run: go test -v -race ./...
      
      - name: Coverage
        run: |
          go test -coverprofile=coverage.out ./...
          go tool cover -func=coverage.out
  
  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: cd frontend && npm ci
      
      - name: Run tests
        run: cd frontend && npm test
```

## Writing Good Tests

### Test Naming

```go
// Good: descriptive, follows convention
func TestConfigService_Get_ReturnsDefaults(t *testing.T)
func TestSignPDF_WithInvalidCert_ReturnsError(t *testing.T)

// Bad: vague names
func TestConfig(t *testing.T)
func Test1(t *testing.T)
```

### Assertions

```go
// Use clear error messages
if got != want {
    t.Errorf("Get() = %v, want %v", got, want)
}

// Use t.Fatal for unrecoverable errors
service, err := NewService()
if err != nil {
    t.Fatalf("NewService() failed: %v", err)
}
```

### Cleanup

```go
func TestWithTempFiles(t *testing.T) {
    // Use t.TempDir() - automatically cleaned up
    tmpDir := t.TempDir()
    
    // Or use t.Cleanup for custom cleanup
    t.Cleanup(func() {
        os.Remove(tempFile)
    })
}
```

## Next Steps

- [Contributing](contributing.md) - Submit your tests
- [Development Setup](setup.md) - Set up test environment
