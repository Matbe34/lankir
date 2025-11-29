/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'accent': 'var(--accent-color)',
        'accent-blue': '#3b82f6',
        'accent-green': '#10b981',
        'border-color': 'var(--border-color)',
        'hover-color': 'var(--hover-color)',
      },
    },
  },
  plugins: [],
}
