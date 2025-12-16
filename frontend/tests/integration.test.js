import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  state, 
  createPDFData, 
  addOpenPDF, 
  removeOpenPDF,
  setActiveTab,
  getActivePDF 
} from '../src/js/state.js';
import { stateEmitter, StateEvents } from '../src/js/eventEmitter.js';

describe('Integration Tests', () => {
  beforeEach(() => {
    state.openPDFs.clear();
    state.activeTabId = null;
    state.nextTabId = 1;
    stateEmitter.events = {};
  });

  describe('PDF Lifecycle', () => {
    it('should handle complete PDF open/close cycle', () => {
      const openHandler = vi.fn();
      const closeHandler = vi.fn();
      
      stateEmitter.on(StateEvents.PDF_OPENED, openHandler);
      stateEmitter.on(StateEvents.PDF_CLOSED, closeHandler);
      
      // Open PDF
      const pdfData = createPDFData(1, '/test.pdf', { pageCount: 10 });
      addOpenPDF(1, pdfData);
      setActiveTab(1);
      stateEmitter.emit(StateEvents.PDF_OPENED, pdfData);
      
      expect(openHandler).toHaveBeenCalledWith(pdfData);
      expect(getActivePDF()).toBe(pdfData);
      
      // Close PDF
      removeOpenPDF(1);
      state.activeTabId = null;
      stateEmitter.emit(StateEvents.PDF_CLOSED, 1);
      
      expect(closeHandler).toHaveBeenCalledWith(1);
      expect(getActivePDF()).toBe(null);
    });

    it('should handle multiple PDFs simultaneously', () => {
      const pdf1 = createPDFData(1, '/doc1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(2, '/doc2.pdf', { pageCount: 10 });
      const pdf3 = createPDFData(3, '/doc3.pdf', { pageCount: 15 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(2, pdf2);
      addOpenPDF(3, pdf3);
      
      expect(state.openPDFs.size).toBe(3);
      
      // Switch between tabs
      setActiveTab(1);
      expect(getActivePDF()).toBe(pdf1);
      
      setActiveTab(2);
      expect(getActivePDF()).toBe(pdf2);
      
      setActiveTab(3);
      expect(getActivePDF()).toBe(pdf3);
      
      // Remove one PDF
      removeOpenPDF(2);
      expect(state.openPDFs.size).toBe(2);
      expect(state.openPDFs.has(2)).toBe(false);
    });
  });

  describe('Tab Switching', () => {
    it('should maintain separate state per tab', () => {
      const pdf1 = createPDFData(1, '/doc1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(2, '/doc2.pdf', { pageCount: 10 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(2, pdf2);
      
      // Modify PDF 1
      setActiveTab(1);
      pdf1.currentPage = 3;
      pdf1.scrollPosition = 100;
      
      // Switch to PDF 2
      setActiveTab(2);
      pdf2.currentPage = 7;
      pdf2.scrollPosition = 500;
      
      // Verify states are independent
      expect(pdf1.currentPage).toBe(3);
      expect(pdf1.scrollPosition).toBe(100);
      expect(pdf2.currentPage).toBe(7);
      expect(pdf2.scrollPosition).toBe(500);
    });

    it('should emit tab switch events', () => {
      const handler = vi.fn();
      stateEmitter.on(StateEvents.TAB_SWITCHED, handler);
      
      const pdf1 = createPDFData(1, '/doc1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(2, '/doc2.pdf', { pageCount: 10 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(2, pdf2);
      
      setActiveTab(1);
      stateEmitter.emit(StateEvents.TAB_SWITCHED, 1);
      
      setActiveTab(2);
      stateEmitter.emit(StateEvents.TAB_SWITCHED, 2);
      
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, 1);
      expect(handler).toHaveBeenNthCalledWith(2, 2);
    });
  });

  describe('Rapid Operations', () => {
    it('should handle rapid tab switching', () => {
      const pdfs = [];
      for (let i = 1; i <= 10; i++) {
        const pdf = createPDFData(i, `/doc${i}.pdf`, { pageCount: i * 5 });
        pdfs.push(pdf);
        addOpenPDF(i, pdf);
      }
      
      // Rapidly switch tabs
      for (let i = 0; i < 100; i++) {
        const tabId = (i % 10) + 1;
        setActiveTab(tabId);
        expect(getActivePDF()).toBe(pdfs[tabId - 1]);
      }
    });

    it('should handle rapid open/close cycles', () => {
      for (let i = 1; i <= 50; i++) {
        const pdf = createPDFData(i, `/doc${i}.pdf`, { pageCount: 10 });
        addOpenPDF(i, pdf);
        setActiveTab(i);
        
        expect(getActivePDF()).toBe(pdf);
        
        removeOpenPDF(i);
        state.activeTabId = null;
      }
      
      expect(state.openPDFs.size).toBe(0);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle accessing non-existent PDF', () => {
      setActiveTab(999);
      const result = getActivePDF();
      expect(result === null || result === undefined).toBe(true);
    });

    it('should handle removing non-existent PDF', () => {
      expect(() => removeOpenPDF(999)).not.toThrow();
    });

    it('should handle duplicate tab IDs', () => {
      const pdf1 = createPDFData(1, '/doc1.pdf', { pageCount: 5 });
      const pdf2 = createPDFData(1, '/doc2.pdf', { pageCount: 10 });
      
      addOpenPDF(1, pdf1);
      addOpenPDF(1, pdf2); // Overwrites
      
      expect(state.openPDFs.size).toBe(1);
      expect(state.openPDFs.get(1)).toBe(pdf2);
    });
  });
});
