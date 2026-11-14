import { describe, it, expect } from 'vitest';

const { getSetting } = await import('../src/js/settings.js');

describe('settings', () => {
  it('defaults to no timestamp server, no location lookup and online revocation checks', () => {
    expect(getSetting('tsaUrl')).toBe('');
    expect(getSetting('signatureLocationLookup')).toBe(false);
    expect(getSetting('checkRevocationOnline')).toBe(true);
  });
});
