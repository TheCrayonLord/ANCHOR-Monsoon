import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Writes the list of built files into sw.js so the app works offline after the first visit.
function precache(): Plugin {
  return {
    name: 'monsoon-precache',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const sw = Object.values(bundle).find((f) => f.fileName === 'sw.js');
      // the AI runtime and model are large: they are fetched and cached the first time they are used
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('ort/') && !f.startsWith('models/'));
      const list = JSON.stringify(['./', ...files.map((f) => './' + f)]);
      if (sw && sw.type === 'asset') {
        sw.source = String(sw.source).replace('self.__PRECACHE__', list).replace('__VERSION__', String(Date.now()));
      }
    },
  };
}

// Ships the on-device AI runtime (WebAssembly) next to the app instead of loading it from another site.
function ortRuntime(): Plugin {
  return {
    name: 'monsoon-ort',
    apply: 'build',
    generateBundle() {
      for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) this.emitFile({ type: 'asset', fileName: 'ort/' + f, source: readFileSync('node_modules/onnxruntime-web/dist/' + f) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precache(), ortRuntime()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
});
