import { describe, it, expect, beforeEach } from 'vitest';
import { 
  state, 
  createPDFData, 
  addOpenPDF, 
  removeOpenPDF, 
  getActivePDF,
  setActiveTab,
  getNextTabId
} from '../src/js/state.js';

describe('State Management', () => {
  beforeEach(() => {
    // Clear state between tests
    state.openPDFs.clear();
    state.activeTabId = null;
    state.nextTabId = 1;
  });

  describe('createPDFData', () => {
    it('should create PDF data structure', () => {
      const metadata = { pageCount: 10 };
      const pdfData = createPDFData(1, '/path/to/file.pdf', metadata);
      
      expect(pdfData.id).toBe(1);
      expect(pdfData.filePath).toBe('/path/to/file.pdf');
      expect(pdfData.fileName).toBe('file.pdf');
      expect(pdfData.totalPages).toBe(10);
      expect(pdfData.currentPage).toBe(0);
      expect(pdfData.renderedPages).toBeInstanceOf(Map);
    });

    it('should extract filename correctly', () => {
      const metadata = { pageCount: 5 };
      const pdfData = createPDFData(1, '/complex/path/to/document.pdf', metadata);
      
      expect(pdfData.fileName).toBe('document.pdf');
    });
  });

  describe('addOpenPDF and removeOpenPDF', () => {
    it('should add PDF to state', () => {
      const pdfData = createPDFData(1, '/test.pdf', { pageCount: 5 });
      addOpenPDF(1, pdfData);
      
      expect(state.openPDFs.has(1)).toBe(true);
      expect(state.openPDFs.get(1)).toBe(pdfData);
    });

    it('should remove PDF from state', () => {
      const pdfData = createPDFData(1, '/test.pdf', { pageCount: 5 });
      addOpenPDF(1, pdfData);
      removeOpenPDF(1);
      
      expect(state.openPDFs.has(1)).toBe(false);
    });

    it('should handle multiple PDFs', () => {
      const pdf1 = createPDFData(1, '/test1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(2, '/test2.pdf', { pageCount: 10 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(2, pdf2);
      
      expect(state.openPDFs.size).toBe(2);
      expect(state.openPDFs.get(1)).toBe(pdf1);
      expect(state.openPDFs.get(2)).toBe(pdf2);
    });
  });

  describe('getActivePDF', () => {
    it('should return active PDF', () => {
      const pdfData = createPDFData(1, '/test.pdf', { pageCount: 5 });
      addOpenPDF(1, pdfData);
      setActiveTab(1);
      
      expect(getActivePDF()).toBe(pdfData);
    });

    it('should return null when no active tab', () => {
      expect(getActivePDF()).toBe(null);
    });

    it('should return null when active tab does not exist', () => {
      setActiveTab(999);
      const result = getActivePDF();
      expect(result === null || result === undefined).toBe(true);
    });
  });

  describe('Tab ID generation', () => {
    it('should generate unique tab IDs', () => {
      const id1 = getNextTabId();
      const id2 = getNextTabId();
      const id3 = getNextTabId();
      
      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });
  });

  describe('State Isolation', () => {
    it('should maintain separate rendered pages per PDF', () => {
      const pdf1 = createPDFData(1, '/test1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(2, '/test2.pdf', { pageCount: 10 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(2, pdf2);
      
      // Modify one PDF's rendered pages
      pdf1.renderedPages.set(1, 'page1-data');
      
      // Other PDF should not be affected
      expect(pdf2.renderedPages.has(1)).toBe(false);
      expect(pdf1.renderedPages.get(1)).toBe('page1-data');
    });
  });
});
