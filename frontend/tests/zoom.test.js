import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setZoomLevel, changeZoom, state } from '../src/js/state.js';
import { ZOOM } from '../src/js/constants.js';

describe('Zoom Functionality', () => {
  beforeEach(() => {
    state.zoomLevel = 1.0;
  });

  describe('setZoomLevel', () => {
    it('should set zoom level within bounds', () => {
      const result = setZoomLevel(1.5);
      expect(result).toBe(1.5);
      expect(state.zoomLevel).toBe(1.5);
    });

    it('should clamp to minimum', () => {
      const result = setZoomLevel(0.05);
      expect(result).toBe(ZOOM.MIN);
      expect(state.zoomLevel).toBe(ZOOM.MIN);
    });

    it('should clamp to maximum', () => {
      const result = setZoomLevel(5.0);
      expect(result).toBe(ZOOM.MAX);
      expect(state.zoomLevel).toBe(ZOOM.MAX);
    });

    it('should handle negative values', () => {
      const result = setZoomLevel(-1);
      expect(result).toBe(ZOOM.MIN);
      expect(state.zoomLevel).toBe(ZOOM.MIN);
    });
  });

  describe('changeZoom', () => {
    it('should increase zoom', () => {
      state.zoomLevel = 1.0;
      const result = changeZoom(0.1);
      expect(result).toBeCloseTo(1.1);
    });

    it('should decrease zoom', () => {
      state.zoomLevel = 1.0;
      const result = changeZoom(-0.1);
      expect(result).toBeCloseTo(0.9);
    });

    it('should respect bounds when increasing', () => {
      state.zoomLevel = 2.95;
      const result = changeZoom(0.2);
      expect(result).toBe(ZOOM.MAX);
    });

    it('should respect bounds when decreasing', () => {
      state.zoomLevel = 0.15;
      const result = changeZoom(-0.2);
      expect(result).toBe(ZOOM.MIN);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero zoom delta', () => {
      state.zoomLevel = 1.0;
      const result = changeZoom(0);
      expect(result).toBe(1.0);
    });

    it('should handle very small increments', () => {
      state.zoomLevel = 1.0;
      const result = changeZoom(0.001);
      expect(result).toBeCloseTo(1.001);
    });
  });
});
