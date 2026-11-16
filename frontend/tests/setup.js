// Test setup file - runs before all tests
import { beforeEach, vi } from 'vitest';

// Mock the generated Wails bindings and runtime; there is no Go backend in tests.
vi.mock('../src/js/backend.js', () => ({
  App: {
    TakeStartupFiles: vi.fn(() => Promise.resolve([])),
    SetUnsavedChanges: vi.fn(() => Promise.resolve()),
    ConfirmClose: vi.fn(() => Promise.resolve()),
    OpenInNewWindow: vi.fn(),
    OpenFileDialog: vi.fn(),
    OpenDirectoryDialog: vi.fn(),
    Version: vi.fn(() => Promise.resolve('dev'))
  },
  PDFService: {
    OpenPDF: vi.fn(),
    OpenPDFByPath: vi.fn(),
    ClosePDF: vi.fn(() => Promise.resolve()),
    SavePDF: vi.fn(),
    SavePDFAs: vi.fn(),
    ChooseSavePath: vi.fn(),
    SetPassword: vi.fn(() => Promise.resolve()),
    SetSaveOptions: vi.fn(() => Promise.resolve()),
    PushWorkingCopy: vi.fn(),
    RotatePages: vi.fn(),
    InsertBlankPage: vi.fn(),
    SetMetadata: vi.fn(),
    UndoPageOp: vi.fn(),
    DropPageOp: vi.fn(),
    RedoPageOp: vi.fn(),
    RevertToSaved: vi.fn(),
    ExportPDF: vi.fn(() => Promise.resolve()),
    ChooseExportFolder: vi.fn(),
    OpenPDFs: vi.fn()
  },
  RecentFilesService: {
    GetRecent: vi.fn(),
    AddRecent: vi.fn(() => Promise.resolve()),
    ClearRecent: vi.fn()
  },
  SignatureService: {
    ListCertificates: vi.fn(),
    SignPDF: vi.fn(),
    VerifySignatures: vi.fn(),
    VerifySignaturesOffline: vi.fn(),
    CheckCertificateRevocation: vi.fn(),
    ListSignatureProfiles: vi.fn(),
    SaveSignatureProfile: vi.fn(),
    DeleteSignatureProfile: vi.fn()
  },
  ConfigService: {
    Get: vi.fn(),
    Update: vi.fn()
  }
}));

vi.mock('@wailsio/runtime', () => ({
  Events: { On: vi.fn(), Emit: vi.fn() },
  Window: { SetTitle: vi.fn(() => Promise.resolve()) },
  Browser: { OpenURL: vi.fn(() => Promise.resolve()) },
  System: { IsLinux: vi.fn(() => false) }
}));

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
