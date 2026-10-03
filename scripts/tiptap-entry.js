/**
 * Single entry point for the vendored editor bundle.
 *
 * Everything the app needs from Tiptap and ProseMirror is re-exported from
 * here so `scripts/vendor-tiptap.mjs` produces ONE file with ONE copy of each
 * prosemirror-* package. Importing two copies breaks `instanceof` checks and
 * schema identity in subtle ways, so app code must import only from
 * `editor/vendor/tiptap/tiptap.esm.js`, never from a CDN or a second bundle.
 */
export { Editor, Extension, Node, mergeAttributes, getSchema } from '@tiptap/core';

export { Document } from '@tiptap/extension-document';
export { Paragraph } from '@tiptap/extension-paragraph';
export { Text } from '@tiptap/extension-text';
export { Bold } from '@tiptap/extension-bold';
export { Italic } from '@tiptap/extension-italic';
export { Underline } from '@tiptap/extension-underline';
export { HardBreak } from '@tiptap/extension-hard-break';
export { Image } from '@tiptap/extension-image';
export { BulletList, OrderedList, ListItem, ListKeymap } from '@tiptap/extension-list';
export { TextAlign } from '@tiptap/extension-text-align';
export { UndoRedo, Gapcursor } from '@tiptap/extensions';
export { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

export { Plugin, PluginKey, TextSelection, AllSelection, NodeSelection, Selection, EditorState } from '@tiptap/pm/state';
export { Fragment, DOMSerializer } from '@tiptap/pm/model';
export { Decoration, DecorationSet } from '@tiptap/pm/view';
export { canJoin, ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform';
export { undoDepth, closeHistory } from '@tiptap/pm/history';
export {
    TableMap, CellSelection, selectedRect, isInTable, addColumn, removeColumn, goToNextCell,
} from '@tiptap/pm/tables';
