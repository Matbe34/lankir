// Applies the theme settings to <html> as token overrides (see styles/tokens.css):
//   data-theme    "light" or "dark"; the "auto" setting follows the system.
//   --accent-base  the user's accent colour; hover and tint shades derive from it.
//   data-palette   the "Theme palette" setting: a hint of colour in the neutral chrome.

// Accents that were only ever the stock default (Go's and the old frontend's):
// those keep each theme's own designed accent instead of overriding it.
const STOCK_ACCENTS = ['#007acc', '#3b82f6'];
const PALETTES = ['neutral', 'slate', 'purple', 'green', 'orange', 'red'];
const HEX = /^#[0-9a-f]{6}$/i;

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Manages the application theme, accent colour and palette. */
export class ThemeManager {
    constructor() {
        this.currentTheme = 'dark';
        this.currentAccentColor = '#3b82f6';
        this.currentSecondaryAccent = 'neutral';
        this.initialized = false;
    }

    /** Applies the stored settings and follows the system theme for "auto". */
    async init() {
        if (this.initialized) return;
        this.loadThemeSettings();
        window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
            if (this.currentTheme === 'auto') this.applyTheme('auto');
        });
        this.initialized = true;
    }

    /** Reads the theme settings saved in localStorage and applies them. */
    loadThemeSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('pdfEditorSettings') || '{}') || {};
            if (settings.theme) this.currentTheme = settings.theme;
            if (settings.accentColor) this.currentAccentColor = settings.accentColor;
            if (settings.secondaryAccent) this.currentSecondaryAccent = settings.secondaryAccent;
        } catch (error) {
            console.warn('Failed to load theme settings:', error);
        }
        this.applyTheme(this.currentTheme);
        this.applyAccentColor(this.currentAccentColor);
        this.applySecondaryAccent(this.currentSecondaryAccent);
    }

    /** Applies "light", "dark" or "auto" (the system's). Anything else is dark. */
    applyTheme(theme) {
        this.currentTheme = ['light', 'dark', 'auto'].includes(theme) ? theme : 'dark';
        document.documentElement.setAttribute('data-theme', this.getEffectiveTheme());
    }

    /** Sets the accent token, or clears it for a stock default. */
    applyAccentColor(color) {
        const style = document.documentElement.style;
        if (HEX.test(color || '') && !STOCK_ACCENTS.includes(color.toLowerCase())) {
            style.setProperty('--accent-base', color);
        } else {
            style.removeProperty('--accent-base');
        }
        this.currentAccentColor = color;
    }

    /** Applies a palette by name; "neutral" (or unknown) is plain grey. */
    applySecondaryAccent(palette) {
        const name = PALETTES.includes(palette) ? palette : 'neutral';
        if (name === 'neutral') document.documentElement.removeAttribute('data-palette');
        else document.documentElement.setAttribute('data-palette', name);
        this.currentSecondaryAccent = palette;
    }

    setTheme(theme) {
        this.applyTheme(theme);
    }

    setAccentColor(color) {
        this.applyAccentColor(color);
    }

    getTheme() {
        return this.currentTheme;
    }

    getAccentColor() {
        return this.currentAccentColor;
    }

    /** "light" or "dark": what the current theme setting shows right now. */
    getEffectiveTheme() {
        if (this.currentTheme === 'auto') return systemDark() ? 'dark' : 'light';
        return this.currentTheme;
    }
}

export const themeManager = new ThemeManager();
