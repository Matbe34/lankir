// Single import point for the generated Wails bindings (run `task bindings`
// after changing exported Go methods), so tests can mock one module.
export { App } from '../../bindings/github.com/Matbe34/lankir/index.js';
export { PDFService, RecentFilesService } from '../../bindings/github.com/Matbe34/lankir/internal/pdf/index.js';
export { SignatureService } from '../../bindings/github.com/Matbe34/lankir/internal/signature/index.js';
export { Service as ConfigService } from '../../bindings/github.com/Matbe34/lankir/internal/config/index.js';
