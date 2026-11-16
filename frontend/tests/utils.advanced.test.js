import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  formatDate, 
  updateZoomDisplay, 
  updatePageIndicator,
  debounce,
  formatFileSize
} from '../src/js/utils.js';

describe('Utils - Advanced Functions', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="zoomDisplay"></div>
      <div id="zoomLevel"></div>
      <input id="zoomInput" />
      <input id="pageInput" />
      <span id="pageTotal"></span>
    `;
  });

  describe('formatFileSize', () => {
    it('uses the largest unit that keeps a short number', () => {
      expect(formatFileSize(512)).toBe('512 bytes');
      expect(formatFileSize(25351)).toBe('24.8 KB');
      expect(formatFileSize(1258291)).toBe('1.2 MB');
      expect(formatFileSize(123456789)).toBe('118 MB');
    });

    it('is empty when the size is unknown', () => {
      expect(formatFileSize(undefined)).toBe('');
      expect(formatFileSize(0)).toBe('');
    });
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
    it('should show current page in the input and the total', () => {
      updatePageIndicator(5, 10);

      expect(document.getElementById('pageInput').value).toBe('5');
      expect(document.getElementById('pageInput').disabled).toBe(false);
      expect(document.getElementById('pageInput').max).toBe('10');
      expect(document.getElementById('pageTotal').textContent).toBe('/ 10');
    });

    it('should clear and disable the input when no pages', () => {
      updatePageIndicator(null, null);

      expect(document.getElementById('pageInput').value).toBe('');
      expect(document.getElementById('pageInput').disabled).toBe(true);
      expect(document.getElementById('pageTotal').textContent).toBe('/ -');
    });

    it('should handle zero values', () => {
      updatePageIndicator(0, 0);

      expect(document.getElementById('pageInput').disabled).toBe(true);
    });

    it('should handle missing element', () => {
      document.body.innerHTML = '';
      expect(() => updatePageIndicator(1, 10)).not.toThrow();
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

describe('middleCut', async () => {
  const { middleCut } = await import('../src/js/utils.js');

  it('keeps a short file name whole', () => {
    expect(middleCut('Master Services Agreement_signed.pdf')).toBe('Master Services Agreement_signed.pdf');
  });

  it('cuts a long one in the middle, so its end stays', () => {
    const cut = middleCut('Acuerdo marco de prestacion de servicios profesionales Northwind Contoso 2026 v3 FINAL firmado_signed.pdf');
    expect(cut).toHaveLength(44);
    expect(cut.startsWith('Acuerdo marco de')).toBe(true);
    expect(cut.endsWith('firmado_signed.pdf')).toBe(true);
    expect(cut).toContain('…');
  });
});
