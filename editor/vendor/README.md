# Vendored libraries

The app is served as static files with no build step, so third-party code is
committed here as pinned browser builds.

## Document editor

| File | Packages | Version |
|------|----------|---------|
| `tiptap/tiptap.esm.js` | [Tiptap](https://tiptap.dev) core + extensions, ProseMirror | see `tiptap/VERSION` |

One ES module bundling every `@tiptap/*` package the editor uses, with exactly
one copy of each ProseMirror package. Built from `scripts/tiptap-entry.js` by
`npm run vendor:tiptap` (esbuild), which fails if a duplicate ProseMirror copy
would end up in the bundle. App code imports it only through
`editor/js/editor/tiptap.js`. To upgrade: bump every `@tiptap/*` version in
`package.json` together (exact pins), `npm install`, `npm run vendor:tiptap`,
then run `npm test` and `make test-e2e`.

## Raster PDF (iOS / iPadOS export)

Pinned browser UMD builds used only by the iOS/iPadOS export path
(`editor/js/export/raster-pdf.js`). Desktop native print does not load these files.

| File | Package | Version |
|------|---------|---------|
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 |

Loaded lazily on first raster-PDF export via classic `<script>` tags (same pattern as Drive GIS).
