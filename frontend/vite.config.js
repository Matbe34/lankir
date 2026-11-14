import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// pdf.js fetches these at runtime (CJK cmaps, the 14 standard fonts, image
// decoders, ICC profiles); viewer.js points getDocument() at /pdfjs/*.
const PDFJS_ASSETS = {
  cmaps: '78-EUC-H.bcmap',
  standard_fonts: 'FoxitSerif.pfb',
  wasm: 'openjpeg.wasm',
  iccs: 'CGATS001Compat-v2-micro.icc',
};
const pdfjsAssets = Object.keys(PDFJS_ASSETS).map((dir) => ({
  src: `node_modules/pdfjs-dist/${dir}/*`,
  dest: `pdfjs/${dir}`,
  // Without this the copy keeps the source path: pdfjs/cmaps/node_modules/...
  rename: { stripBase: true },
}));

// A misplaced asset only shows at runtime, as a 404 on some PDFs.
let outDir;
const checkPdfjsAssets = {
  name: 'check-pdfjs-assets',
  apply: 'build',
  configResolved(config) {
    outDir = resolve(config.root, config.build.outDir);
  },
  closeBundle() {
    for (const [dir, file] of Object.entries(PDFJS_ASSETS)) {
      const path = resolve(outDir, 'pdfjs', dir, file);
      if (!existsSync(path)) throw new Error(`pdf.js asset missing from the build: ${path}`);
    }
  },
};

export default defineConfig({
  plugins: [tailwindcss(), viteStaticCopy({ targets: pdfjsAssets }), checkPdfjsAssets],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // pdf.js 6 uses top-level await and recent built-ins (WebKitGTK 2.50 has them).
    target: 'esnext',
  },
  worker: { format: 'es' },
});
