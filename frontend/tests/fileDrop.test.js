import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The real runtime, not the setup.js mock: its document-level drag listeners
// stop WebKit from navigating to a dropped file, which is why fileOpener.js no
// longer needs its own preventDefault workaround (wails#3686).
vi.unmock('@wailsio/runtime');
// The runtime announces itself to Go on load; there is no Go side here.
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
await import('@wailsio/runtime');

// happy-dom's DragEvent drops dataTransfer, so attach a minimal file drag payload by hand.
function fileDragEvent(type) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], dropEffect: 'none', items: [], files: [] },
  });
  return event;
}

describe('Wails runtime file drop handling', () => {
  it.each(['dragenter', 'dragover', 'drop'])('prevents the WebKit default for a file %s', (type) => {
    document.body.setAttribute('data-file-drop-target', '');
    const event = fileDragEvent(type);
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('index.html', () => {
  // Wails v3 ignores OS drops that don't land on a [data-file-drop-target] element.
  it('marks the whole body as a file drop target', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toMatch(/<body[^>]*\sdata-file-drop-target[\s>=]/);
  });
});
