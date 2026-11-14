import { openFilePath } from './documents.js';
import { showOpenError } from './errorRecovery.js';
import { showToast } from './toast.js';
import { App } from './backend.js';
import { Events } from '@wailsio/runtime';

/**
 * Open each path as a new tab in the current window. Skips empty input with a
 * single info toast; a file that fails gets an error dialog and doesn't stop
 * the batch.
 *
 * Funnels three sources: window drops and second-instance launches (Go emits
 * "open-files") and the startup file args (pulled by initFileOpening).
 *
 * @param {string[]} paths Absolute file paths.
 */
export async function handleOpenFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    showToast('Only PDF files can be opened');
    return;
  }

  for (const path of paths) {
    try {
      await openFilePath(path);
    } catch (err) {
      await showOpenError(err, { path });
    }
  }
}

/**
 * Subscribe to "open-files", then pull the files passed on the command line.
 * Go queues every path until TakeStartupFiles is called, so registering the
 * listener first means no path is lost or opened twice.
 */
export function initFileOpening() {
  Events.On('open-files', (event) => handleOpenFiles(event.data));
  return App.TakeStartupFiles()
    .then((files) => (files.length > 0 ? handleOpenFiles(files) : undefined))
    .catch((err) => console.error('Failed to get startup files:', err));
}
