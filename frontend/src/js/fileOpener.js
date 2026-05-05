import { createPDFTab, switchToTab } from './pdfManager.js';
import { showMessage } from './messageDialog.js';

/**
 * Workaround for wailsapp/wails#3686 (closed 2025-08-02 with this fix
 * accepted by the maintainer). On Linux WebKit2GTK, dropping a file on the
 * window triggers WebKit's default file-navigation in addition to Wails'
 * Go-side OnFileDrop callback, hijacking the app UI with a chrome-style
 * file viewer. Calling preventDefault on every drag-related JS event
 * blocks the WebKit default; Wails' Go callback still fires via the GTK
 * signal path and is unaffected.
 */
export function suppressWebViewDropDefault() {
  const events = [
    'drop', 'dragover', 'dragleave', 'drag', 'dragend', 'dragenter', 'dragstart',
  ];
  for (const evt of events) {
    window.addEventListener(evt, (e) => e.preventDefault());
  }
}

/**
 * Open each path as a new tab in the current window. Skips empty input with a
 * single info toast; per-file errors get a toast and don't stop the batch.
 *
 * Funnels three sources: drag-drop (Wails OnFileDrop emits "open-files"),
 * OS "Open with" via SingleInstanceLock, and startup `initialFiles`. All
 * three emit the Wails "open-files" event; subscribe in app.js with
 * `runtime.EventsOn('open-files', handleOpenFiles)`.
 *
 * @param {string[]} paths Absolute file paths.
 */
export async function handleOpenFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    showMessage('No PDF files in drop', 'Open files', 'info');
    return;
  }

  let lastTab = null;
  for (const path of paths) {
    try {
      const metadata = await window.go.pdf.PDFService.OpenPDFByPath(path);
      lastTab = createPDFTab(metadata.filePath, metadata);
    } catch (err) {
      showMessage(`Failed to open ${path}: ${err?.message ?? err}`, 'Open failed', 'error');
    }
  }
  if (lastTab) switchToTab(lastTab);
}
