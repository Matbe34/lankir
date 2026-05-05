import { createPDFTab, switchToTab } from './pdfManager.js';
import { showMessage } from './messageDialog.js';

/**
 * Open each path as a new tab in the current window. Skips empty input with a
 * single info toast; per-file errors get a toast and don't stop the batch.
 *
 * Funnels three sources: drag-drop, OS "Open with" via SingleInstanceLock,
 * and startup `initialFiles`. All three emit the Wails "open-files" event;
 * subscribe in app.js with `runtime.EventsOn('open-files', handleOpenFiles)`.
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
