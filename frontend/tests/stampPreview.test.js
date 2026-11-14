import { describe, it, expect } from 'vitest';
import { stampParts } from '../src/js/stampPreview.js';

const lines = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('.preview-line')].map((l) => l.textContent.replace(/\s+/g, ' ').trim());
};

describe('stampParts', () => {
  it('lists the lines the profile draws, in the order the stamp draws them', () => {
    const appearance = { showSignerName: true, showSigningTime: true, showLocation: true, customText: 'Approved' };
    const stamp = stampParts(appearance, { signerName: 'Maria Garcia', date: '14 Nov 2026, 10:00', location: 'Girona' });
    expect(lines(stamp.html)).toEqual(['Signed by Maria Garcia', 'Date 14 Nov 2026, 10:00', 'Location Girona', 'Approved']);
    expect(stamp.lines).toBe(4);
    expect(stamp.layout).toBe('icon-left');
  });

  it('leaves out what the profile turns off and a location it has none of', () => {
    const stamp = stampParts({ showSignerName: true, showLocation: true }, { signerName: 'Maria', date: 'now', location: '' });
    expect(lines(stamp.html)).toEqual(['Signed by Maria']);
  });

  it('escapes the text it shows', () => {
    const stamp = stampParts({ showSignerName: true }, { signerName: '<b>x</b>', date: '' });
    expect(stamp.html).not.toContain('<b>');
    expect(lines(stamp.html)).toEqual(['Signed by <b>x</b>']);
  });

  it('is empty when nothing shows', () => {
    expect(stampParts({}, { signerName: 'Maria', date: 'now' }).html).toBe('');
  });

  it('shows the image, with a placeholder only when asked for one', () => {
    const withImage = stampParts({ showLogo: true, logoPosition: 'top' }, { iconDataUrl: 'data:image/png;base64,AAAA' });
    expect(withImage.html).toContain('<img');
    expect(withImage.layout).toBe('icon-top');
    expect(stampParts({ showLogo: true }, {}).html).toBe('');
    expect(stampParts({ showLogo: true }, { iconPlaceholder: true }).html).toContain('preview-icon-empty');
  });
});
