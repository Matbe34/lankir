import { describe, it, expect } from 'vitest';
import { UI, LIMITS, CACHE, SIGNATURE } from '../src/js/constants.js';

describe('Constants Configuration', () => {
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
