import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('index.html', `file://${process.cwd()}/`), 'utf8');
const body = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel) => document.querySelector(sel);

beforeEach(() => {
  document.body.innerHTML = body;
});

describe('start page', () => {
  it('keeps the Open button plain and shows its shortcut as quiet keys beside it', () => {
    const open = $('#welcomeOpenBtn');
    expect(open.textContent.trim()).toBe('Open file…');
    expect(open.querySelector('.keys')).toBeNull();
    expect(open.nextElementSibling.matches('.keys[data-shortcut="openFile"]')).toBe(true);
  });

  it('keeps the drop zone to a single row: no icon above it', () => {
    const zone = $('.drop-zone');
    expect(zone.querySelector('[data-icon]')).toBeNull();
    expect(zone.children).toHaveLength(1);
    expect(zone.firstElementChild.matches('.drop-row')).toBe(true);
  });
});

describe('copy', () => {
  it('never breaks "PAdES B-T" at its hyphen', () => {
    expect(page).not.toMatch(/B-T\b/);
    expect(page).toContain('PAdES B‑T');
  });
});
