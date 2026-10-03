#!/usr/bin/env node
/**
 * Bundle the `docx` library into one committed ES module:
 *   editor/vendor/docx/docx.esm.js
 *
 * Same pattern as scripts/vendor-tiptap.mjs: the app is served as static
 * files, so the bundle is built here and committed. It is loaded lazily on
 * the first Word export. Re-run after bumping the pinned `docx` version:
 *   npm run vendor:docx
 *
 *   npm run vendor:docx -- --check
 * fails if the committed bundle differs from what the pinned version builds.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'editor/vendor/docx/docx.esm.js');
const version = JSON.parse(readFileSync(join(root, 'node_modules/docx/package.json'), 'utf8')).version;
const check = process.argv.includes('--check');

mkdirSync(dirname(outfile), { recursive: true });

const result = await build({
    entryPoints: [join(root, 'scripts/docx-entry.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2020'],
    platform: 'browser',
    outfile,
    write: !check,
    legalComments: 'none',
    banner: { js: `/* docx ${version} — vendored by scripts/vendor-docx.mjs. MIT licensed. Do not edit. */` },
});

const versionFile = join(dirname(outfile), 'VERSION');
if (check) {
    const built = Buffer.from(result.outputFiles[0].contents);
    const committed = existsSync(outfile) ? readFileSync(outfile) : Buffer.alloc(0);
    const committedVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '';
    if (!built.equals(committed) || committedVersion !== version) {
        console.error(`${outfile} is out of date with the installed docx ${version}. Run: npm run vendor:docx`);
        process.exit(1);
    }
    console.log(`Vendored bundle matches docx ${version}`);
    process.exit(0);
}

writeFileSync(versionFile, `${version}\n`);
console.log(`Wrote ${outfile} (${(readFileSync(outfile).length / 1024).toFixed(0)} KB, docx ${version})`);
