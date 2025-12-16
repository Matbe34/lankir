import { describe, it, expect } from 'vitest';
import { ZOOM, DPI, PERFORMANCE, UI, LIMITS, CACHE, SIGNATURE } from '../src/js/constants.js';

describe('Constants Configuration', () => {
  describe('ZOOM', () => {
    it('should have valid range', () => {
      expect(ZOOM.MIN).toBe(0.1);
      expect(ZOOM.MAX).toBe(3.0);
      expect(ZOOM.DEFAULT).toBe(1.0);
      expect(ZOOM.MIN).toBeLessThan(ZOOM.DEFAULT);
      expect(ZOOM.DEFAULT).toBeLessThan(ZOOM.MAX);
    });

    it('should have reasonable step', () => {
      expect(ZOOM.STEP).toBeGreaterThan(0);
      expect(ZOOM.STEP).toBeLessThan(1);
    });

    it('should have throttle delay', () => {
      expect(ZOOM.THROTTLE_MS).toBeGreaterThan(0);
      expect(ZOOM.THROTTLE_MS).toBeLessThan(1000);
    });
  });

  describe('DPI', () => {
    it('should have screen and render DPI', () => {
      expect(DPI.SCREEN).toBe(96);
      expect(DPI.RENDER).toBeGreaterThan(DPI.SCREEN);
      expect(DPI.SCALE).toBe(96 / 150);
    });
  });

  describe('PERFORMANCE', () => {
    it('should have lazy load configuration', () => {
      expect(PERFORMANCE.LAZY_LOAD_BUFFER_PX).toBeGreaterThan(0);
      expect(PERFORMANCE.LAZY_LOAD_DEBOUNCE_MS).toBeGreaterThan(0);
    });

    it('should have background load settings', () => {
      expect(PERFORMANCE.BACKGROUND_LOAD_BATCH_SIZE).toBeGreaterThan(0);
      expect(PERFORMANCE.BACKGROUND_LOAD_DELAY_MS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('UI', () => {
    it('should have loading indicator minimum display time', () => {
      expect(UI.LOADING_MIN_DISPLAY_MS).toBeGreaterThan(0);
    });

    it('should have thumbnail dimensions', () => {
      expect(UI.THUMBNAIL_WIDTH).toBeGreaterThan(0);
    });
  });

  describe('LIMITS', () => {
    it('should have icon size limits', () => {
      expect(LIMITS.MAX_ICON_SIZE_MB).toBeGreaterThan(0);
      expect(LIMITS.MAX_ICON_SIZE_BYTES).toBe(LIMITS.MAX_ICON_SIZE_MB * 1024 * 1024);
    });
  });

  describe('CACHE', () => {
    it('should have expiration settings', () => {
      expect(CACHE.EXPIRATION_DAYS).toBeGreaterThan(0);
      expect(CACHE.EXPIRATION_MS).toBe(CACHE.EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    });
  });

  describe('SIGNATURE', () => {
    it('should have dimension limits', () => {
      expect(SIGNATURE.MIN_WIDTH).toBeGreaterThan(0);
      expect(SIGNATURE.MAX_WIDTH).toBeGreaterThan(SIGNATURE.MIN_WIDTH);
      expect(SIGNATURE.MIN_HEIGHT).toBeGreaterThan(0);
      expect(SIGNATURE.MAX_HEIGHT).toBeGreaterThan(SIGNATURE.MIN_HEIGHT);
    });
  });
});
