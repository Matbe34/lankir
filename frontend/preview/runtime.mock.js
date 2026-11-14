// Stand-in for @wailsio/runtime in the browser preview. Unknown members are
// harmless async no-ops, so a new runtime call never breaks the preview.
const lenient = (impl) => new Proxy(impl, {
  get: (target, key) => {
    if (key in target) return target[key];
    if (typeof key === 'symbol' || key === 'then') return undefined;
    return async () => null;
  },
});

const listeners = new Map();

export const Events = lenient({
  On(name, callback) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return () => listeners.get(name)?.delete(callback);
  },
  Off(...names) {
    for (const name of names) listeners.delete(name);
  },
  Emit(name, data) {
    for (const cb of listeners.get(name) ?? []) cb({ name, data });
  },
});

export const Browser = lenient({ OpenURL: async () => {} });
export const System = lenient({ IsLinux: () => true, IsWindows: () => false, IsMac: () => false });
export const Window = lenient({ SetTitle: async () => {} });
