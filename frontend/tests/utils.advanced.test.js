import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  formatDate, 
  updateZoomDisplay, 
  updatePageIndicator,
  updateScrollProgress,
  debounce 
} from '../src/js/utils.js';

describe('Utils - Advanced Functions', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="zoomDisplay"></div>
      <div id="zoomLevel"></div>
      <input id="zoomInput" />
      <div id="pageIndicator"></div>
      <div id="scrollProgress"></div>
    `;
  });

  describe('formatDate', () => {
    it('should format ISO date strings', () => {
      const isoDate = '2025-12-16T10:30:00.000Z';
      const result = formatDate(isoDate);
      
      expect(result).toBeTruthy();
      expect(result).toContain('/');
      expect(result).toContain(':');
    });

    it('should handle invalid dates', () => {
      const result = formatDate('invalid-date');
      
      // formatDate returns "Invalid Date Invalid Date" for invalid dates in happy-dom
      expect(result).toContain('Invalid Date');
    });

    it('should handle malformed input', () => {
      const result = formatDate('not-a-date-at-all');
      expect(result).toContain('Invalid Date');
    });
  });

  describe('updateZoomDisplay', () => {
    it('should update all zoom elements', () => {
      updateZoomDisplay(1.5);
      
      expect(document.getElementById('zoomDisplay').textContent).toBe('150%');
      expect(document.getElementById('zoomLevel').textContent).toBe('150%');
      expect(document.getElementById('zoomInput').value).toBe('150');
    });

    it('should handle decimal zoom levels', () => {
      updateZoomDisplay(1.25);
      
      expect(document.getElementById('zoomDisplay').textContent).toBe('125%');
    });

    it('should round percentages', () => {
      updateZoomDisplay(1.337);
      
      const percentage = document.getElementById('zoomDisplay').textContent;
      expect(percentage).toBe('134%');
    });

    it('should handle missing elements gracefully', () => {
      document.body.innerHTML = '';
      expect(() => updateZoomDisplay(1.0)).not.toThrow();
    });
  });

  describe('updatePageIndicator', () => {
    it('should show current page and total', () => {
      updatePageIndicator(5, 10);
      
      expect(document.getElementById('pageIndicator').textContent).toBe('Page 5 of 10');
    });

    it('should show dash when no pages', () => {
      updatePageIndicator(null, null);
      
      expect(document.getElementById('pageIndicator').textContent).toBe('-');
    });

    it('should handle zero values', () => {
      updatePageIndicator(0, 0);
      
      expect(document.getElementById('pageIndicator').textContent).toBe('-');
    });

    it('should handle missing element', () => {
      document.body.innerHTML = '';
      expect(() => updatePageIndicator(1, 10)).not.toThrow();
    });
  });

  describe('updateScrollProgress', () => {
    it('should show percentage', () => {
      updateScrollProgress(75.5);
      
      expect(document.getElementById('scrollProgress').textContent).toContain('76%');
    });

    it('should round percentages', () => {
      updateScrollProgress(33.7);
      
      expect(document.getElementById('scrollProgress').textContent).toContain('34%');
    });

    it('should show dash for null', () => {
      updateScrollProgress(null);
      
      expect(document.getElementById('scrollProgress').textContent).toBe('-');
    });

    it('should show dash for undefined', () => {
      updateScrollProgress(undefined);
      
      expect(document.getElementById('scrollProgress').textContent).toBe('-');
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should delay function execution', () => {
      const func = vi.fn();
      const debounced = debounce(func, 100);
      
      debounced();
      expect(func).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(100);
      expect(func).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous calls', () => {
      const func = vi.fn();
      const debounced = debounce(func, 100);
      
      debounced();
      debounced();
      debounced();
      
      vi.advanceTimersByTime(100);
      expect(func).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments correctly', () => {
      const func = vi.fn();
      const debounced = debounce(func, 100);
      
      debounced('arg1', 'arg2', 'arg3');
      vi.advanceTimersByTime(100);
      
      expect(func).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should reset timer on subsequent calls', () => {
      const func = vi.fn();
      const debounced = debounce(func, 100);
      
      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50);
      
      expect(func).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(50);
      expect(func).toHaveBeenCalledTimes(1);
    });
  });
});
