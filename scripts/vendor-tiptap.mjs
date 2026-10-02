#!/usr/bin/env node
/**
 * Bundle the editor dependencies into one committed ES module:
 *   editor/vendor/tiptap/tiptap.esm.js
 *
 * The app is served as static files with no build step, so the bundle is
 * produced here once and committed (same pattern as the other files in
 * editor/vendor/). Re-run after bumping the pinned @tiptap/* versions:
 *   npm run vendor:tiptap
 *
 * Fails if more than one copy of a prosemirror-* package ends up in the
 * bundle — duplicate instances break schema identity at runtime.
 *
 *   npm run vendor:tiptap -- --check
 * rebuilds in memory and fails if the committed bundle differs (CI runs this,
 * so the shipped file always matches the pinned versions in package-lock).
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'editor/vendor/tiptap/tiptap.esm.js');
const version = JSON.parse(readFileSync(join(root, 'node_modules/@tiptap/core/package.json'), 'utf8')).version;
const check = process.argv.includes('--check');

mkdirSync(dirname(outfile), { recursive: true });

const result = await build({
    entryPoints: [join(root, 'scripts/tiptap-entry.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2020'],
    outfile,
    write: !check,
    metafile: true,
    legalComments: 'none',
    banner: { js: `/* Tiptap ${version} + ProseMirror — vendored by scripts/vendor-tiptap.mjs. MIT licensed. Do not edit. */` },
});

const copies = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
    const m = input.match(/node_modules\/((?:prosemirror|orderedmap|rope-sequence|w3c-keyname)[^/]*)\/(.*)$/);
    if (!m) continue;
    const pkgRoot = input.slice(0, input.indexOf(m[1]) + m[1].length);
    if (!copies.has(m[1])) copies.set(m[1], new Set());
    copies.get(m[1]).add(pkgRoot);
}
const dupes = [...copies].filter(([, roots]) => roots.size > 1);
if (dupes.length) {
    console.error('Duplicate ProseMirror packages in bundle:');
    for (const [name, roots] of dupes) console.error(`  ${name}: ${[...roots].join(', ')}`);
    process.exit(1);
}

if (check) {
    const built = Buffer.from(result.outputFiles[0].contents);
    const committed = existsSync(outfile) ? readFileSync(outfile) : Buffer.alloc(0);
    const versionFile = join(dirname(outfile), 'VERSION');
    const committedVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '';
    if (!built.equals(committed) || committedVersion !== version) {
        console.error(`${outfile} is out of date with the installed @tiptap/* ${version}. Run: npm run vendor:tiptap`);
        process.exit(1);
    }
    console.log(`Vendored bundle matches @tiptap/* ${version}`);
    process.exit(0);
}

const bytes = readFileSync(outfile).length;
writeFileSync(join(dirname(outfile), 'VERSION'), `${version}\n`);
console.log(`Wrote ${outfile} (${(bytes / 1024).toFixed(0)} KB, Tiptap ${version}, ${copies.size} prosemirror-family packages, no duplicates)`);
