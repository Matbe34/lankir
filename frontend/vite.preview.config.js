// Browser preview of the frontend with a mocked backend (no Go, no Wails):
//   npm run preview:mock   ->   http://127.0.0.1:9317/?scene=viewer
// See preview/scenes.js for the scene names.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config.js';

const root = import.meta.dirname;
const jsDir = resolve(root, 'src/js') + sep;
const mock = (name) => resolve(root, 'preview', name);

// backend.js is imported relatively from src/js/*, so match on the resolved file.
const previewMocks = {
  name: 'preview-mocks',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!/(^|\/)backend\.js$/.test(source) || !importer?.startsWith(jsDir)) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === resolve(jsDir, 'backend.js') ? mock('backend.mock.js') : null;
  },
  transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/preview/main.js' }, injectTo: 'body' }],
  // The app's PDFs come from Go at /doc/<id>; ids look like <fixture>-<n>.
  configureServer(server) {
    server.middlewares.use('/doc', (req, res, next) => {
      const match = /^\/(contract|notes)-\d+$/.exec(req.url.split('?')[0]);
      const file = match && resolve(root, 'preview/fixtures', `${match[1]}.pdf`);
      if (!file || !existsSync(file) || req.method !== 'GET') return next();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', statSync(file).size);
      createReadStream(file).pipe(res);
    });
  },
};

export default mergeConfig(baseConfig, defineConfig({
  plugins: [previewMocks],
  resolve: { alias: [{ find: /^@wailsio\/runtime$/, replacement: mock('runtime.mock.js') }] },
  // Pre-bundle pdf.js up front: finding it late makes the dev server reload the page mid-scene.
  optimizeDeps: { include: ['pdfjs-dist', 'pdfjs-dist/web/pdf_viewer.mjs'] },
  server: { port: Number(process.env.PREVIEW_PORT) || 9317, hmr: false },
}));
