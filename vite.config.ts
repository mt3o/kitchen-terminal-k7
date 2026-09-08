import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

// Safari 15.0 is a hard floor, not a preference: the iPad Air 2 (A1567) and the
// iPhone 6s both stop at iOS/iPadOS 15. Anything newer than this target silently
// produces a blank screen on the only device that matters.
export default defineConfig({
  // The config file is passed explicitly: `root` below is src/client, and the
  // plugin resolves svelte.config.js relative to the Vite root, not the project
  // root. Without this it silently falls back to defaults — customElement is
  // never applied, <k7-card> is never registered, and the build stays green
  // while the screen stays blank.
  plugins: [svelte({ configFile: resolve(import.meta.dirname, 'svelte.config.js') })],
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    target: ['safari15', 'es2021'],
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    cssTarget: 'safari15',
  },
  server: {
    host: true,
    port: 5173,
    // The dev server serves the client; the Layout comes from Fastify on 8080.
    // Without this proxy the dev page fetches /api/layout from :5173, gets the
    // SPA fallback back, and fails on JSON.parse — with no CORS plugin on the
    // server, pointing it at the absolute URL would fail too. Run `npm run
    // dev:server` alongside `npm run dev`.
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
  },
})
