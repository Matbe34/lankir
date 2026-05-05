import { createPDFTab, switchToTab } from './pdfManager.js';
import { showMessage } from './messageDialog.js';

/**
 * Open each path as a new tab in the current window. Skips empty input with a
 * single info toast; per-file errors get a toast and don't stop the batch.
 *
 * Funnels two sources: HTML5 drag-drop (wired by registerDragDrop) and the
 * Wails "open-files" event (OS "Open with" via SingleInstanceLock + startup
 * initialFiles).
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

/**
 * Wails v2.10.2's native Linux drag-drop (`options.DragAndDrop.EnableFileDrop`)
 * is broken — its GTK handler returns FALSE so WebKit's default file-navigation
 * fires too, hijacking the window with the built-in PDF viewer. Setting
 * `DisableWebViewDrop: true` removes the webview as a drop target entirely,
 * silencing the callback.
 *
 * This implementation bypasses the Wails plumbing entirely: standard HTML5
 * dragover/drop with `e.preventDefault()` blocks WebKit's navigation, and
 * `dataTransfer.getData('text/uri-list')` gives us absolute paths (file://
 * URIs) without any backend round-trip. Works the same on all OSes.
 */
export function registerDragDrop() {
  const onDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e) => {
    e.preventDefault();
    const paths = extractFilePaths(e.dataTransfer);
    const pdfs = paths.filter(p => /\.pdf$/i.test(p));
    if (pdfs.length === 0) {
      if (paths.length > 0) showMessage('No PDF files in drop', 'Open files', 'info');
      return;
    }
    handleOpenFiles(pdfs);
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
}

function extractFilePaths(dt) {
  if (!dt) return [];
  const uriList = dt.getData('text/uri-list');
  if (!uriList) return [];
  return uriList
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.startsWith('file://'))
    .map(s => decodeURIComponent(s.slice('file://'.length)));
}
