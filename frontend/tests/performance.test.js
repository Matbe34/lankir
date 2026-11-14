import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, createPDFData, addOpenPDF, setActiveTab } from '../src/js/state.js';
import { stateEmitter, StateEvents } from '../src/js/eventEmitter.js';

describe('Performance Tests', () => {
  beforeEach(() => {
    state.openPDFs.clear();
    state.activeTabId = null;
    state.nextTabId = 1;
    stateEmitter.events = {};
  });

  describe('Large Scale Operations', () => {
    it('should handle 100 PDFs', () => {
      for (let i = 1; i <= 100; i++) {
        const pdf = createPDFData(i, `/doc${i}.pdf`, { pageCount: 50 });
        addOpenPDF(i, pdf);
      }

      expect(state.openPDFs.size).toBe(100);
    });

    it('should handle 1000 event listeners', () => {
      const handlers = [];

      for (let i = 0; i < 1000; i++) {
        const handler = vi.fn();
        stateEmitter.on('test', handler);
        handlers.push(handler);
      }

      stateEmitter.emit('test', 'data');

      handlers.forEach(h => expect(h).toHaveBeenCalledWith('data'));
      handlers.forEach(h => expect(h).toHaveBeenCalledTimes(1));
    });

    it('should switch between 50 tabs', () => {
      const pdfs = [];
      for (let i = 1; i <= 50; i++) {
        const pdf = createPDFData(i, `/doc${i}.pdf`, { pageCount: 10 });
        pdfs.push(pdf);
        addOpenPDF(i, pdf);
      }

      for (let i = 0; i < 200; i++) {
        const tabId = (i % 50) + 1;
        setActiveTab(tabId);
      }

      expect(state.activeTabId).toBe(50);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory on repeated operations', () => {
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        const pdf = createPDFData(i, `/doc${i}.pdf`, { pageCount: 10 });
        addOpenPDF(i, pdf);
        state.openPDFs.delete(i);
      }
      
      expect(state.openPDFs.size).toBe(0);
    });

    it('should cleanup event listeners', () => {
      const handlers = [];
      const unsubscribers = [];

      for (let i = 0; i < 1000; i++) {
        const handler = vi.fn();
        handlers.push(handler);
        unsubscribers.push(stateEmitter.on('test', handler));
      }

      unsubscribers.forEach(u => u());
      stateEmitter.emit('test');

      handlers.forEach(h => expect(h).not.toHaveBeenCalled());
    });

    it('should handle Map operations', () => {
      const map = new Map();

      // Add 10000 items
      for (let i = 0; i < 10000; i++) {
        map.set(i, { data: `item-${i}` });
      }
      
      // Check 1000 random items
      for (let i = 0; i < 1000; i++) {
        const key = Math.floor(Math.random() * 10000);
        map.has(key);
        map.get(key);
      }
      
      // Delete 5000 items
      for (let i = 0; i < 5000; i++) {
        map.delete(i);
      }

      expect(map.size).toBe(5000);
    });
  });

  describe('Rendering Performance Patterns', () => {
    it('should batch DOM updates', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      // Simulate batched updates using DocumentFragment
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 100; i++) {
        const div = document.createElement('div');
        div.textContent = `Item ${i}`;
        fragment.appendChild(div);
      }
      container.appendChild(fragment);

      expect(container.children.length).toBe(100);
      
      container.remove();
    });
  });

  describe('Data Structure Performance', () => {
    it('should compare Set vs Array for lookups', () => {
      const size = 10000;
      const array = Array.from({ length: size }, (_, i) => i);
      const set = new Set(array);
      
      // Set lookup
      const setStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        set.has(Math.floor(Math.random() * size));
      }
      const setDuration = performance.now() - setStart;
      
      // Array lookup
      const arrayStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        array.includes(Math.floor(Math.random() * size));
      }
      const arrayDuration = performance.now() - arrayStart;
      
      // Set should be faster
      expect(setDuration).toBeLessThan(arrayDuration);
    });

    it('should look up the same values in a Map and an Object', () => {
      const size = 1000;
      const map = new Map();
      const obj = {};
      
      // Populate
      for (let i = 0; i < size; i++) {
        map.set(`key${i}`, i);
        obj[`key${i}`] = i;
      }
      
      for (let i = 0; i < 1000; i++) {
        const n = Math.floor(Math.random() * size);
        expect(map.get(`key${n}`)).toBe(n);
        expect(obj[`key${n}`]).toBe(n);
      }
    });
  });
});
