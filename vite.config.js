// vite.config.js
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

// Not named __dirname — Vite's config loader (esbuild, under the hood) defines
// that identifier as a literal string replacement for CJS compat, which clobbers
// a same-named const declaration.
const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        viewer: resolve(rootDir, 'viewer.html'),
        bluesky: resolve(rootDir, 'bluesky.html'),
        youtube: resolve(rootDir, 'youtube.html'),
      },
    },
  },
})