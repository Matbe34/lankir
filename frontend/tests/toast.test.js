import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast, showBusy, toastPlacement } from '../src/js/toast.js';
import { iconSvg } from '../src/js/icons.js';

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

  it('can be updated while it shows and dismissed by its caller', () => {
    const progress = showToast('Preparing to print · page 1 of 3', { timeout: 0 });
    progress.update('Preparing to print · page 2 of 3');
    const toast = region().querySelector('.toast');
    expect(toast.querySelector('.toast-text').textContent).toBe('Preparing to print · page 2 of 3');
    progress.dismiss();
    expect(toast.classList.contains('leaving')).toBe(true);
  });

  it('can show how far a job has got, and leave out its × for one that cancels instead', () => {
    const cancel = vi.fn();
    const job = showToast('Preparing to print · page 1 of 4', { timeout: 0, progress: 0, closable: false, action: { label: 'Cancel', run: cancel } });
    const toast = region().querySelector('.toast');
    const bar = toast.querySelector('.toast-progress');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.style.getPropertyValue('--progress')).toBe('0');
    job.update('Preparing to print · page 3 of 4', 0.5);
    expect(bar.style.getPropertyValue('--progress')).toBe('0.5');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(toast.querySelector('[aria-label="Dismiss"]')).toBeNull();
    expect([...toast.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancel']);
  });

  it('has no progress bar unless asked', () => {
    showToast('Saved');
    expect(region().querySelector('.toast-progress')).toBeNull();
    expect(region().querySelector('[aria-label="Dismiss"]')).not.toBeNull();
  });

  it('can show its own icon', () => {
    showToast('Preparing to print · page 1 of 3', { icon: 'printer' });
    const printer = document.createElement('div');
    printer.innerHTML = iconSvg('printer');
    expect(region().querySelector('.toast > svg').outerHTML).toBe(printer.firstElementChild.outerHTML);
  });

  it('without a region it still hands back a handle that does nothing', () => {
    document.body.innerHTML = '';
    const handle = showToast('x');
    expect(() => { handle.update('y'); handle.dismiss(); }).not.toThrow();
  });

  it('keeps at most three', () => {
    for (let i = 0; i < 5; i++) showToast(`n${i}`);
    expect(region().children).toHaveLength(3);
    expect(region().textContent).toContain('n4');
  });

  it('never makes room by taking away one without a ×, such as a print’s progress', () => {
    showToast('Preparing to print · page 1 of 3', { timeout: 0, closable: false });
    for (let i = 0; i < 5; i++) showToast(`n${i}`);
    expect(region().children).toHaveLength(3);
    expect(region().textContent).toContain('Preparing to print');
    expect(region().textContent).toContain('n4');
  });
});

describe('showBusy', () => {
  it('keeps one toast however often it is asked, and holds it open again', () => {
    vi.useFakeTimers();
    try {
      showToast('3 unsaved changes', { timeout: 8000 });
      showBusy();
      vi.advanceTimersByTime(3000);
      showBusy();
      showBusy();
      expect([...region().querySelectorAll('.toast-text')].map((t) => t.textContent))
        .toEqual(['3 unsaved changes', 'Wait for the current change to finish']);
      // The last ask counts its time again.
      vi.advanceTimersByTime(3000);
      expect(region().querySelector('.toast:last-child').classList.contains('leaving')).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(region().textContent).not.toContain('Wait for');
      showBusy();
      expect(region().textContent).toContain('Wait for');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays while the pointer or the focus holds it, however often it is asked again', () => {
    vi.useFakeTimers();
    try {
      showBusy();
      const toast = region().querySelector('.toast');
      toast.dispatchEvent(new Event('pointerenter'));
      showBusy();
      vi.advanceTimersByTime(10000);
      expect(toast.classList.contains('leaving')).toBe(false);
      toast.dispatchEvent(new Event('pointerleave'));
      toast.dispatchEvent(new Event('focusin'));
      showBusy();
      vi.advanceTimersByTime(10000);
      expect(toast.classList.contains('leaving')).toBe(false);
      toast.dispatchEvent(new Event('focusout'));
      vi.advanceTimersByTime(4500);
      expect(toast.classList.contains('leaving')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('where toasts go', () => {
  // The page pill, 266 wide, centred low in a 1440 or 1024 wide, 900 high window.
  const pill = (viewport) => ({ left: viewport / 2 - 133, right: viewport / 2 + 133, top: 900 - 12 - 32 });

  it('stays bottom right, level with the page pill, when there is room between them', () => {
    // 1440 wide: a 350px stack starts at x 1074, 221px clear of the pill's right edge at 853.
    expect(toastPlacement({ pill: pill(1440), stack: 350, width: 1440, height: 900 })).toBeNull();
    expect(toastPlacement({ pill: null, stack: 350, width: 800, height: 600 })).toBeNull();
  });

  it('lifts the stack, still at the right, above the pill when they would sit close side by side', () => {
    // 1024 wide: a 350px stack starts at x 658, only 13px clear of the pill's right edge at 645.
    expect(toastPlacement({ pill: pill(1024), stack: 350, width: 1024, height: 900 })).toEqual({ bottom: 900 - 856 + 12 });
    // 48px clear is enough.
    expect(toastPlacement({ pill: { left: 300, right: 610, top: 856 }, stack: 350, width: 1024, height: 900 })).toBeNull();
    const shifted = { left: 600, right: 866, top: 856 }; // a side panel moved the page aside
    expect(toastPlacement({ pill: shifted, stack: 350, width: 1024, height: 900 })).toEqual({ bottom: 900 - 856 + 12 });
  });
});
