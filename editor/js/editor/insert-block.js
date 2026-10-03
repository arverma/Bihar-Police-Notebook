/**
 * Insert a block (image, table) into a writing box.
 *
 * The block always lands as a direct child of the box's flowCell — never
 * inside a paragraph, list item or table cell — so the pager sees it as one
 * unit it can move (or, for a table, cut between rows). A paragraph is kept
 * after it so typing can continue below without a gap cursor.
 */
import { TextSelection, Selection, closeHistory } from './tiptap.js';

/** Depth of the flowCell ancestor of a resolved position, or -1. */
function cellDepth($pos) {
    for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === 'flowCell') return d;
    }
    return -1;
}

/** Whether a resolved position is inside a table. */
export function inTable($pos) {
    for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === 'table') return true;
    }
    return false;
}

/**
 * Insert `node` at `pos` (default: the selection, replacing any selected
 * content). Inside a paragraph the paragraph is split at that point; inside
 * a list or table the block goes after it.
 *
 * @param {import('prosemirror-state').Transaction} tr
 * @param {import('prosemirror-model').Node} node
 * @param {number} [pos]
 * @returns {boolean} whether the block was inserted
 */
export function insertBlock(tr, node, pos) {
    // Inserting is one undo step of its own, not merged into nearby typing.
    closeHistory(tr);
    if (pos == null) {
        if (!tr.selection.empty) tr.deleteSelection();
        pos = tr.selection.from;
    }
    const $pos = tr.doc.resolve(pos);
    const d = cellDepth($pos);
    if (d < 0) return false;
    const { paragraph } = tr.doc.type.schema.nodes;

    let at;
    let caretAfter = true; // caret goes after the block unless set below
    if ($pos.depth === d) {
        // Between blocks (gap cursor, or a selected image's position).
        at = pos;
    } else if ($pos.depth === d + 1 && $pos.parent.isTextblock) {
        const para = $pos.parent;
        const start = $pos.before(d + 1);
        if (para.content.size === 0) {
            // An empty line becomes the block (plus a line to keep typing on).
            tr.replaceWith(start, start + para.nodeSize, [node, paragraph.create()]);
            setCaret(tr, node, start);
            return true;
        }
        if ($pos.parentOffset === 0) {
            at = start;
            caretAfter = false;
        } else if ($pos.parentOffset === para.content.size) {
            at = $pos.after(d + 1);
        } else {
            // Mid-line: split, and put the block between the two halves.
            tr.split(pos);
            at = pos + 1;
        }
    } else {
        // Inside a list or table: after the whole top-level block.
        at = $pos.after(d + 1);
    }

    const keepCaret = caretAfter ? null : tr.mapping.map(pos);
    tr.insert(at, node);
    const after = at + node.nodeSize;
    const next = tr.doc.resolve(after).nodeAfter;
    if (!next || next.type.name === 'image' || next.type.name === 'table') {
        tr.insert(after, paragraph.create());
    }
    if (keepCaret != null) {
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(keepCaret)));
    } else {
        setCaret(tr, node, at);
    }
    return true;
}

/** Caret into a new table's first cell, or onto the line after a block. */
function setCaret(tr, node, at) {
    if (node.type.name === 'table') {
        tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1));
    } else {
        tr.setSelection(Selection.near(tr.doc.resolve(at + node.nodeSize), 1));
    }
}
