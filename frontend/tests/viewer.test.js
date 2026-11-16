import { describe, it, expect, vi } from 'vitest';

const viewerOptions = [];
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AnnotationEditorType: { NONE: 0 },
  AnnotationEditorParamsType: {},
  AnnotationMode: {},
  PasswordResponses: {},
  PDFDateString: {}
}));
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'worker.mjs' }));
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  EventBus: class {},
  PDFLinkService: class { setViewer() {} },
  PDFFindController: class {},
  PDFViewer: class { constructor(options) { viewerOptions.push(options); } }
}));

const { createViewer, keepPageGutter } = await import('../src/js/viewer.js');

describe('createViewer', () => {
  it('gives the viewer no per-tab abort signal', async () => {
    // pdf.js ties TextLayerBuilder's document-wide selection listeners (shared
    // by every viewer) to the first text layer's signal; aborting it when that
    // tab closes leaves the other tabs' annotation layers unclickable.
    await createViewer(document.body);
    expect(viewerOptions[0].abortSignal).toBeUndefined();
  });
});

describe('keepPageGutter', () => {
  // A view whose pages are 1000px apart; pdf.js scrolls a page it goes to
  // flush with the top of the view.
  function setup() {
    const container = document.createElement('div');
    container.style.setProperty('--page-gutter', '16px');
    document.body.append(container);
    container.getBoundingClientRect = () => ({ top: 44 });
    const pages = [1, 2, 3].map((n) => {
      const div = document.createElement('div');
      div.getBoundingClientRect = () => ({ top: 44 + n * 1000 - container.scrollTop - 9 });
      Object.defineProperty(div, 'clientTop', { value: 9 });
      return { div };
    });
    class FakeViewer {
      constructor() { this._page = 1; }
      get currentPageNumber() { return this._page; }
      set currentPageNumber(n) { this._page = n; container.scrollTop = n * 1000; }
      scrollPageIntoView({ pageNumber, destArray }) {
        this._page = pageNumber;
        container.scrollTop = pageNumber * 1000 + (destArray ? 300 : 0);
      }
      getPageView(i) { return pages[i]; }
      nextPage() { this.currentPageNumber = this._page + 1; }
    }
    const viewer = new FakeViewer();
    keepPageGutter(viewer, container);
    return { viewer, container };
  }

  it('leaves the gutter above a page it goes to', () => {
    const { viewer, container } = setup();
    viewer.currentPageNumber = 2;
    expect(container.scrollTop).toBe(2000 - 16);
    expect(viewer.currentPageNumber).toBe(2);
    viewer.nextPage();
    expect(container.scrollTop).toBe(3000 - 16);
    viewer.scrollPageIntoView({ pageNumber: 1 });
    expect(container.scrollTop).toBe(1000 - 16);
  });

  it('leaves a destination inside a page where pdf.js put it', () => {
    const { viewer, container } = setup();
    viewer.scrollPageIntoView({ pageNumber: 2, destArray: [null, { name: 'XYZ' }, 0, 100, null] });
    expect(container.scrollTop).toBe(2300);
  });
});
