// vite.config.js
import { resolve, dirname, relative, sep, join } from 'path'
import { fileURLToPath } from 'url'
import { readdirSync, statSync, readFileSync } from 'fs'
import { defineConfig } from 'vite'

// Not named __dirname — Vite's config loader (esbuild, under the hood) defines
// that identifier as a literal string replacement for CJS compat, which clobbers
// a same-named const declaration.
const rootDir = dirname(fileURLToPath(import.meta.url))

// Mirrors src/main.js's deriveTitle so listed datasets read the same way
// they will once loaded in the viewer.
function deriveTitle(sources) {
  if (!sources || sources.length === 0) return 'Untitled Visualization'
  if (sources.length === 1) return sources[0].label
  return `${sources.length} sources: ${sources.map(s => s.label).join(', ')}`
}

function findOutputFiles(dir, results = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      findOutputFiles(full, results)
    } else if (entry.name === 'output.json') {
      results.push(full)
    }
  }
  return results
}

// Dev-only: lets data.html discover pipeline outputs (data/**/output.json)
// without a build step to keep in sync. data/ is gitignored and never
// deployed, so this middleware has nothing to serve outside `npm run dev`.
function dataOutputsPlugin() {
  return {
    name: 'data-outputs-api',
    configureServer(server) {
      server.middlewares.use('/api/data-outputs', (req, res) => {
        const dataDir = join(rootDir, 'data')
        const datasets = findOutputFiles(dataDir).map((full) => {
          const urlPath = '/' + relative(rootDir, full).split(sep).join('/')
          const entry = { path: urlPath, title: relative(dataDir, dirname(full)), pointCount: null, mtimeMs: statSync(full).mtimeMs }
          try {
            const data = JSON.parse(readFileSync(full, 'utf8'))
            entry.title = deriveTitle(data.sources)
            entry.pointCount = Array.isArray(data.points) ? data.points.length : null
          } catch {
            // Leave the fallback title/pointCount in place for unparsable files.
          }
          return entry
        }).sort((a, b) => b.mtimeMs - a.mtimeMs)

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(datasets))
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [dataOutputsPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        viewer: resolve(rootDir, 'viewer.html'),
        bluesky: resolve(rootDir, 'bluesky.html'),
        youtube: resolve(rootDir, 'youtube.html'),
        hackernews: resolve(rootDir, 'hackernews.html'),
        lexicon: resolve(rootDir, 'lexicon.html'),
      },
    },
  },
})
