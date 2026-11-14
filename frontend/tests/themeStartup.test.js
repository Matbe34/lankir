import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '../src/js/backend.js';
import { initSettings } from '../src/js/settings.js';

describe('startup theme', () => {
  beforeEach(() => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  // localStorage is per origin and the Wails v3 origin differs from v2, so the
  // backend config must win when localStorage is empty.
  it('applies the backend theme when localStorage is empty', async () => {
    ConfigService.Get.mockResolvedValue({ theme: 'light', accentColor: '#ff0000' });
    await initSettings();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // secondaryAccent lives only in localStorage (not in the backend config),
  // so a restart must keep it instead of resetting to the default palette.
  it('keeps the stored secondary accent across restarts', async () => {
    localStorage.setItem('pdfEditorSettings', JSON.stringify({ secondaryAccent: 'purple' }));
    ConfigService.Get.mockResolvedValue({ theme: 'dark', accentColor: '#ff0000' });
    const { getSetting } = await import('../src/js/settings.js');
    const { themeManager } = await import('../src/js/themeManager.js');
    themeManager.initialized = false;
    await initSettings();
    expect(themeManager.currentSecondaryAccent).toBe('purple');
    expect(getSetting('secondaryAccent')).toBe('purple');
  });

  it('keeps custom shortcuts across restarts', async () => {
    const shortcuts = { openFile: 'Control+p' };
    localStorage.setItem('pdfEditorSettings', JSON.stringify({ shortcuts }));
    ConfigService.Get.mockResolvedValue({ theme: 'dark' });
    const { getSetting } = await import('../src/js/settings.js');
    await initSettings();
    expect(getSetting('shortcuts').openFile).toBe('Control+p');
    expect(getSetting('shortcuts').sign).toBe('Alt+s');
  });
});
