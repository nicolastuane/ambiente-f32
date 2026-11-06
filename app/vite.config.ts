import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// One id per build: the service worker is registered as sw.js?v=<id>, so every
// deploy installs a fresh worker and drops the caches of the previous one.
const BUILD_ID = Date.now().toString(36);
const APP_VERSION = '1.0.0';

/** Emits precache.json (the hashed bundle files) for public/sw.js to pre-cache. */
function precacheManifest(): Plugin {
  return {
    name: 'ambiente-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'));
      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify({ build: BUILD_ID, files }, null, 2),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precacheManifest()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    // Allows the random https://*.trycloudflare.com URL of a quick tunnel.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
