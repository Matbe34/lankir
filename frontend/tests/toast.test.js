import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast } from '../src/js/toast.js';

const region = () => document.getElementById('toastRegion');

beforeEach(() => {
  document.body.innerHTML = '<div id="toastRegion" aria-live="polite"></div>';
});

describe('showToast', () => {
  it('shows an action that runs and dismisses the toast', () => {
    const run = vi.fn();
    showToast('Signed and saved as a_signed.pdf', { tone: 'success', action: { label: 'Open', run } });
    const toast = region().querySelector('.toast');
    expect(toast.classList.contains('success')).toBe(true);
    toast.querySelector('.toast-action').click();
    expect(run).toHaveBeenCalled();
    expect(toast.classList.contains('leaving')).toBe(true);
  });

  it('has warning and error variants; errors are announced at once', () => {
    showToast('Low on space', { tone: 'warning' });
    showToast('Couldn’t sign', { tone: 'error' });
    const [warning, error] = region().querySelectorAll('.toast');
    expect(warning.classList.contains('warning')).toBe(true);
    expect(warning.getAttribute('role')).toBe('status');
    expect(error.getAttribute('role')).toBe('alert');
  });

  it('keeps at most three', () => {
    for (let i = 0; i < 5; i++) showToast(`n${i}`);
    expect(region().children).toHaveLength(3);
    expect(region().textContent).toContain('n4');
  });
});
