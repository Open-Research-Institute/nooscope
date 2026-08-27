// Bundles a collector's scraper (real ES module, real imports) into one flat,
// self-executing script — the shape a `javascript:` bookmarklet href needs.
// Regenerate with `npm run build:bookmarklets` (also runs automatically before
// `dev`/`build`). Output is gitignored; nothing here is meant to be committed.
import { build } from 'vite';
import { mkdir, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = resolve(rootDir, 'src/generated');

const targets = [
    { name: 'twitter-scraper', entry: 'src/collectors/twitter/scraper.js' },
];

await mkdir(outDir, { recursive: true });

for (const target of targets) {
    const result = await build({
        root: rootDir,
        configFile: false,
        logLevel: 'warn',
        build: {
            write: false,
            emptyOutDir: false,
            lib: {
                entry: resolve(rootDir, target.entry),
                formats: ['iife'],
                name: '__noscopeBookmarklet',
                fileName: () => `${target.name}.js`,
            },
        },
    });

    const output = Array.isArray(result) ? result[0] : result;
    const code = output.output[0].code;
    const outPath = resolve(outDir, `${target.name}.js`);
    await writeFile(outPath, code);
    console.log(`Built ${target.entry} -> src/generated/${target.name}.js (${code.length} bytes)`);
}
