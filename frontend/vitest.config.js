import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'wailsjs/',
        'dist/',
        '**/*.config.js',
        '**/build.sh'
      ],
      include: ['src/js/**/*.js']
    },
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'wailsjs']
  }
});
