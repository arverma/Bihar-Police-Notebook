/**
 * The only import point for Tiptap / ProseMirror in app code.
 *
 * Re-exports the vendored single-file bundle so every module shares one copy
 * of prosemirror-model/state/view (see scripts/vendor-tiptap.mjs).
 */
export * from '../../vendor/tiptap/tiptap.esm.js';
