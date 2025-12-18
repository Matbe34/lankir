/** Manages application theme, accent colors, and secondary color palettes. */
export class ThemeManager {
    constructor() {
        this.currentTheme = 'dark'; // default
        this.currentAccentColor = '#3b82f6'; // default blue
        this.currentSecondaryAccent = 'neutral'; // default palette
        this.initialized = false;
    }

    /** Initializes theme settings from localStorage and sets up system theme listener. */
    async init() {
        if (this.initialized) return;

        this.loadThemeSettings();
        this.setupSystemThemeListener();

        this.initialized = true;
    }

    /** Loads theme settings from localStorage and applies them. */
    loadThemeSettings() {
        try {
            const stored = localStorage.getItem('pdfEditorSettings');
            if (stored) {
                const settings = JSON.parse(stored);

                if (settings.theme) {
                    this.currentTheme = settings.theme;
                }

                if (settings.accentColor) {
                    this.currentAccentColor = settings.accentColor;
                }

                if (settings.secondaryAccent) {
                    this.currentSecondaryAccent = settings.secondaryAccent;
                }
            }

            this.applyTheme(this.currentTheme);
            this.applyAccentColor(this.currentAccentColor);
            this.applySecondaryAccent(this.currentSecondaryAccent);
        } catch (error) {
            console.warn('Failed to load theme settings:', error);
            this.applyTheme(this.currentTheme);
            this.applyAccentColor(this.currentAccentColor);
            this.applySecondaryAccent(this.currentSecondaryAccent);
        }
    }

    /** Listens for system dark mode changes when using auto theme. */
    setupSystemThemeListener() {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

        darkModeQuery.addEventListener('change', (e) => {
            if (this.currentTheme === 'auto') {
                this.applyTheme('auto');
            }
        });
    }

    /** Applies the specified theme (light, dark, or auto) to the document. */
    applyTheme(theme) {
        const root = document.documentElement;

        switch (theme) {
            case 'light':
                root.setAttribute('data-theme', 'light');
                break;
            case 'dark':
                root.setAttribute('data-theme', 'dark');
                break;
            case 'auto':
                root.setAttribute('data-theme', 'auto');
                break;
            default:
                root.setAttribute('data-theme', 'dark');
        }

        this.currentTheme = theme;
    }

    /** Applies the accent color and computed hover color to CSS variables. */
    applyAccentColor(color) {
        const root = document.documentElement;
        root.style.setProperty('--accent-color', color);

        const hoverColor = this.darkenColor(color, 10);
        root.style.setProperty('--accent-hover', hoverColor);

        this.currentAccentColor = color;
    }

    /** Applies a secondary color palette (neutral, slate, purple, etc.) to backgrounds. */
    applySecondaryAccent(palette) {
        const palettes = {
            neutral: {
                dark: {
                    primary: '#0f1419',
                    secondary: '#161b22',
                    tertiary: '#1c2128',
                    elevated: '#21262d',
                    border: '#30363d',
                    borderSubtle: '#21262d',
                    hover: '#252c35'
                },
                light: {
                    primary: '#ffffff',
                    secondary: '#f6f8fa',
                    tertiary: '#eef1f5',
                    elevated: '#ffffff',
                    border: '#d0d7de',
                    borderSubtle: '#e7ecf0',
                    hover: '#f3f4f6'
                }
            },
            slate: {
                dark: {
                    primary: '#0f172a',
                    secondary: '#1e293b',
                    tertiary: '#334155',
                    elevated: '#475569',
                    border: '#475569',
                    borderSubtle: '#334155',
                    hover: '#334155'
                },
                light: {
                    primary: '#ffffff',
                    secondary: '#f8fafc',
                    tertiary: '#f1f5f9',
                    elevated: '#ffffff',
                    border: '#cbd5e1',
                    borderSubtle: '#e2e8f0',
                    hover: '#f1f5f9'
                }
            },
            purple: {
                dark: {
                    primary: '#1a0b2e',
                    secondary: '#2d1b4e',
                    tertiary: '#3d2a5f',
                    elevated: '#4a3572',
                    border: '#6b4e9a',
                    borderSubtle: '#4a3572',
                    hover: '#4a3572'
                },
                light: {
                    primary: '#fdfaff',
                    secondary: '#faf5ff',
                    tertiary: '#f3e8ff',
                    elevated: '#ffffff',
                    border: '#d8b4fe',
                    borderSubtle: '#f3e8ff',
                    hover: '#f3e8ff'
                }
            },
            green: {
                dark: {
                    primary: '#0a1f1a',
                    secondary: '#0f2f28',
                    tertiary: '#174239',
                    elevated: '#1f5549',
                    border: '#2d7a68',
                    borderSubtle: '#1f5549',
                    hover: '#1f5549'
                },
                light: {
                    primary: '#f7fef9',
                    secondary: '#ecfdf5',
                    tertiary: '#d1fae5',
                    elevated: '#ffffff',
                    border: '#6ee7b7',
                    borderSubtle: '#d1fae5',
                    hover: '#d1fae5'
                }
            },
            orange: {
                dark: {
                    primary: '#1f1209',
                    secondary: '#2f1e10',
                    tertiary: '#452e1a',
                    elevated: '#5a3d24',
                    border: '#7c5635',
                    borderSubtle: '#5a3d24',
                    hover: '#5a3d24'
                },
                light: {
                    primary: '#fffbf5',
                    secondary: '#fffbeb',
                    tertiary: '#fef3c7',
                    elevated: '#ffffff',
                    border: '#fbbf24',
                    borderSubtle: '#fef3c7',
                    hover: '#fef3c7'
                }
            },
            red: {
                dark: {
                    primary: '#1f0a0a',
                    secondary: '#2f1515',
                    tertiary: '#4a2020',
                    elevated: '#5f2a2a',
                    border: '#7f3838',
                    borderSubtle: '#5f2a2a',
                    hover: '#5f2a2a'
                },
                light: {
                    primary: '#fffafa',
                    secondary: '#fef2f2',
                    tertiary: '#fee2e2',
                    elevated: '#ffffff',
                    border: '#fca5a5',
                    borderSubtle: '#fee2e2',
                    hover: '#fee2e2'
                }
            }
        };

        const effectiveTheme = this.getEffectiveTheme();
        const paletteColors = palettes[palette]?.[effectiveTheme] || palettes.neutral[effectiveTheme];

        const root = document.documentElement;
        root.style.setProperty('--bg-primary', paletteColors.primary);
        root.style.setProperty('--bg-secondary', paletteColors.secondary);
        root.style.setProperty('--bg-tertiary', paletteColors.tertiary);
        root.style.setProperty('--bg-elevated', paletteColors.elevated);
        root.style.setProperty('--border-color', paletteColors.border);
        root.style.setProperty('--border-subtle', paletteColors.borderSubtle);
        root.style.setProperty('--hover-color', paletteColors.hover);

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

    darkenColor(color, percent) {
        color = color.replace('#', '');

        const r = parseInt(color.substring(0, 2), 16);
        const g = parseInt(color.substring(2, 4), 16);
        const b = parseInt(color.substring(4, 6), 16);

        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);

        const toHex = (n) => {
            const hex = n.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
    }

    getEffectiveTheme() {
        if (this.currentTheme === 'auto') {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            return darkModeQuery.matches ? 'dark' : 'light';
        }
        return this.currentTheme;
    }
}

export const themeManager = new ThemeManager();