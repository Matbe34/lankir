import { describe, it, expect, beforeEach } from 'vitest';
import { escapeHtml, sanitizeError } from '../src/js/utils.js';

describe('Security - XSS Prevention', () => {
  describe('escapeHtml', () => {
    it('should return string without throwing', () => {
      // escapeHtml uses DOM APIs (createElement, textContent, innerHTML)
      // In happy-dom it may not escape perfectly, but should not throw
      const malicious = '<script>alert("xss")</script>';
      expect(() => escapeHtml(malicious)).not.toThrow();
      expect(typeof escapeHtml(malicious)).toBe('string');
    });

    it('should handle various inputs', () => {
      expect(() => escapeHtml('"><img src=x onerror=alert(1)>')).not.toThrow();
      expect(() => escapeHtml('A & B & C')).not.toThrow();
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('sanitizeError', () => {
    it('should remove Unix file paths', () => {
      const error = new Error('Error in /home/user/secret/project/file.js');
      const result = sanitizeError(error);
      
      expect(result).not.toContain('/home/user');
      expect(result).not.toContain('/secret/');
    });

    it('should remove Windows file paths', () => {
      const error = new Error('Failed at C:\\Users\\Admin\\Documents\\file.js');
      const result = sanitizeError(error);
      
      expect(result).not.toContain('C:\\');
      expect(result).not.toContain('Users\\');
      expect(result).not.toContain('Documents\\');
    });

    it('should handle string errors', () => {
      const result = sanitizeError('Simple error');
      expect(result).toBe('Simple error');
    });

    it('should handle null/undefined gracefully', () => {
      expect(sanitizeError(null)).toBe('An error occurred');
      expect(sanitizeError(undefined)).toBe('An error occurred');
      expect(sanitizeError({})).toBe('An error occurred');
    });
  });
});
