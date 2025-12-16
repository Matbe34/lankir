// Test setup file - runs before all tests
import { beforeEach, vi } from 'vitest';

// Mock Wails runtime
global.window = global.window || {};
global.window.go = {
  pdf: {
    PDFService: {
      OpenPDF: vi.fn(),
      OpenPDFByPath: vi.fn(),
      RenderPage: vi.fn(),
      ClosePDF: vi.fn()
    },
    RecentFilesService: {
      GetRecent: vi.fn(),
      AddRecent: vi.fn(),
      ClearRecent: vi.fn()
    }
  },
  signature: {
    SignatureService: {
      ListCertificates: vi.fn(),
      SignPDFWithProfile: vi.fn(),
      SignPDFWithProfileAndPosition: vi.fn(),
      VerifySignatures: vi.fn(),
      ListSignatureProfiles: vi.fn(),
      CreateSignatureProfile: vi.fn(),
      DeleteSignatureProfile: vi.fn()
    }
  },
  config: {
    Service: {
      Get: vi.fn(),
      Set: vi.fn()
    }
  },
  main: {
    App: {
      OpenFileDialog: vi.fn(),
      SaveFileDialog: vi.fn()
    }
  }
};

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  // Reset DOM
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};
