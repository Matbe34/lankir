import { AnnotationMode } from './viewer.js';
import { updateStatus, sanitizeError } from './utils.js';
import { showMessage } from './messageDialog.js';
import { showToast, showBusy } from './toast.js';
import { state } from './state.js';
import { syncOrganize } from './organize.js';

// Printing goes through the webview: WebKitGTK answers window.print() with
// the GTK print dialog (Wails' own Window.Print() does the same on Linux).
// Like pdf.js' viewer, every page is rendered to an image in a container
// that only print media shows, sized by the first page (@page); other page
// sizes are fitted onto it. The rules live here, with the container they
// are for, only while printing.

const PRINT_DPI = 150;
const PRINT_RULES = `
#printContainer { display: none; }
@media print {
  body > :not(#printContainer) { display: none !important; }
  html, body { height: 100%; overflow: visible !important; background: none !important; }
  #printContainer { display: block; height: 100%; }
  #printContainer > .print-page { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; break-after: page; break-inside: avoid; }
  #printContainer > .print-page:last-child { break-after: auto; }
  #printContainer img { display: block; max-width: 100%; max-height: 100%; }
}`;
let printing = false;

/** Renders the tab's pages, form values and annotations included, and opens the print dialog. */
export async function printTab(tab) {
    if (!tab?.pdfDocument) return false;
    if (printing || tab.busy) {
        showBusy();
        return false;
    }
    printing = true;
    // A page operation's reload would destroy the document being rendered.
    tab.busy = true;
    const doc = tab.pdfDocument;
    const container = document.createElement('div');
    container.id = 'printContainer';
    const style = document.createElement('style');
    const urls = [];
    let progress = null;
    let cancelled = false;
    try {
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        style.textContent = `@page { size: ${first.width}pt ${first.height}pt; margin: 0; }${PRINT_RULES}`;
        const printAnnotationStorage = doc.annotationStorage.print;
        const optionalContentConfigPromise = doc.getOptionalContentConfig({ intent: 'print' });
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
            const message = `Preparing to print · page ${n} of ${doc.numPages}`;
            const done = (n - 1) / doc.numPages;
            if (progress) progress.update(message, done);
            else {
                progress = showToast(message, {
                    timeout: 0, icon: 'printer', progress: done, closable: false,
                    action: { label: 'Cancel', run: () => { cancelled = true; } }
                });
            }
            const page = await doc.getPage(n);
            const viewport = page.getViewport({ scale: PRINT_DPI / 72 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({
                canvas,
                viewport,
                intent: 'print',
                annotationMode: AnnotationMode.ENABLE_STORAGE,
                printAnnotationStorage,
                optionalContentConfigPromise
            }).promise;
            const blob = await new Promise((resolve) => canvas.toBlob(resolve));
            canvas.width = canvas.height = 0;
            urls.push(URL.createObjectURL(blob));
            const img = document.createElement('img');
            img.src = urls.at(-1);
            const sheet = document.createElement('div');
            sheet.className = 'print-page';
            sheet.append(img);
            container.append(sheet);
        }
        if (cancelled) {
            updateStatus('Ready');
            return false;
        }
        document.head.append(style);
        document.body.append(container);
        await Promise.all([...container.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
        // The dialog blocks the page, which would keep a fading toast on screen.
        await progress?.dismiss();
        progress = null;
        updateStatus('Printing…');
        // Blocks until the print dialog is closed and the job is spooled.
        window.print();
        updateStatus('Ready');
        return true;
    } catch (error) {
        console.error('Print failed:', error);
        updateStatus('Print failed');
        await showMessage(sanitizeError(error), `Lankir couldn’t print “${tab.fileName}”`, 'error');
        return false;
    } finally {
        progress?.dismiss();
        container.remove();
        style.remove();
        for (const url of urls) URL.revokeObjectURL(url);
        printing = false;
        tab.busy = false;
        // The organize bar disables the page actions while the tab is held.
        if (state.activeTabId === tab.id) syncOrganize(tab);
    }
}
