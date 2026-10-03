/**
 * Keeps the page structure intact and makes page edges behave like a single
 * continuous column for the keyboard.
 *
 *  - Selections never span more than one cell. Each page's cell is selected
 *    on its own (as a separate editor per page would), so every edit stays
 *    inside one cell and can never merge pages or columns.
 *  - User transactions whose replace steps cross a cell boundary are dropped
 *    (safety net for drag-and-drop and anything the clamp doesn't cover).
 *  - Backspace / Delete / arrows at a cell edge continue into the same column
 *    on the neighbouring page.
 */
import { Extension, Plugin, PluginKey, TextSelection, AllSelection, ReplaceStep, ReplaceAroundStep } from './tiptap.js';
import { collectPages, cellContentRange } from './pager/layout.js';
import { PAGER_META } from './pager/plugin.js';
import { STRUCTURE_META } from './page-views.js';

const HISTORY_META = 'history$';

/** Depth of the flowCell ancestor of a resolved position, or -1. */
function cellDepth($pos) {
    for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === 'flowCell') return d;
    }
    return -1;
}

/** Start position (before the node) of the cell containing $pos, or null. */
function cellStart($pos) {
    const d = cellDepth($pos);
    return d < 0 ? null : $pos.before(d);
}

function isExempt(tr) {
    return tr.getMeta(PAGER_META) || tr.getMeta(STRUCTURE_META) || tr.getMeta(HISTORY_META);
}

/** Whether every replace step stays inside one cell. */
export function stepsStayInCells(tr) {
    for (let i = 0; i < tr.steps.length; i++) {
        const step = tr.steps[i];
        if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) continue;
        const doc = tr.docs[i];
        const a = cellStart(doc.resolve(step.from));
        const b = cellStart(doc.resolve(step.to));
        if (a === null || a !== b) return false;
    }
    return true;
}

/** Range of the current cell's content for a resolved position. */
function cellRangeAt($pos) {
    const d = cellDepth($pos);
    if (d < 0) return null;
    return { from: $pos.start(d), to: $pos.end(d), node: $pos.node(d) };
}

/** First/last text position inside a cell range. */
function textStart(doc, from) {
    return TextSelection.near(doc.resolve(from), 1).from;
}
function textEnd(doc, to) {
    return TextSelection.near(doc.resolve(to), -1).to;
}

/** Same-column cell on the neighbouring page. */
function neighbourCell(doc, $pos, dir) {
    const d = cellDepth($pos);
    if (d < 0) return null;
    const col = $pos.node(d).attrs.col;
    const pageIndex = $pos.index(0);
    const pages = collectPages(doc);
    const page = pages[pageIndex + dir];
    return page ? page.cells[col] : null;
}

/** Is the caret in the first (dir<0) or last (dir>0) textblock of its cell? */
function atCellEdgeBlock($pos, dir) {
    const d = cellDepth($pos);
    if (d < 0) return false;
    // Walk up from the textblock to the cell: every ancestor must be the
    // first (or last) child of its parent.
    for (let depth = $pos.depth; depth > d; depth--) {
        const index = $pos.index(depth - 1);
        const parent = $pos.node(depth - 1);
        if (dir < 0 ? index !== 0 : index !== parent.childCount - 1) return false;
    }
    return true;
}

function caretAtCellStart(state) {
    const { selection } = state;
    if (!selection.empty) return null;
    const $pos = selection.$from;
    if ($pos.parentOffset !== 0 || !atCellEdgeBlock($pos, -1)) return null;
    if ($pos.depth !== cellDepth($pos) + 1) return null; // paragraphs directly in the cell; lists lift first
    return $pos;
}

function caretAtCellEnd(state) {
    const { selection } = state;
    if (!selection.empty) return null;
    const $pos = selection.$from;
    if ($pos.parentOffset !== $pos.parent.content.size || !atCellEdgeBlock($pos, 1)) return null;
    if ($pos.depth !== cellDepth($pos) + 1) return null;
    return $pos;
}

/**
 * Backspace at the start of a cell continues into the previous page:
 * a continuation loses the last character before the page edge; a separate
 * paragraph joins onto the previous page's last paragraph.
 */
export function backspaceAcrossPage(state, dispatch) {
    const $pos = caretAtCellStart(state);
    if (!$pos || $pos.index(0) === 0) return false;
    const prev = neighbourCell(state.doc, $pos, -1);
    if (!prev) return false;
    const block = $pos.parent;
    const prevLast = prev.node.lastChild;
    const prevLastPos = prev.pos + 1 + prev.node.content.size - prevLast.nodeSize;
    if (!dispatch) return true;
    const tr = state.tr;

    if (block.attrs.cont && prevLast.isTextblock && prevLast.content.size > 0) {
        // Delete one grapheme before the page edge; the pager re-joins.
        const end = prevLastPos + 1 + prevLast.content.size;
        const text = prevLast.textContent;
        const seg = typeof Intl !== 'undefined' && Intl.Segmenter
            ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].pop()?.segment.length ?? 1
            : 1;
        tr.delete(end - Math.min(seg, prevLast.content.size), end);
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(end, -1)));
    } else if (prevLast.isTextblock && block.isTextblock) {
        // Join this paragraph onto the end of the previous page's last one.
        const from = $pos.before();
        const to = $pos.after();
        const cell = cellRangeAt($pos);
        const only = cell.node.childCount === 1;
        const content = block.content;
        const joinAt = prevLastPos + 1 + prevLast.content.size;
        if (only) tr.replaceWith(from, to, state.schema.nodes.paragraph.create());
        else tr.delete(from, to);
        const at = tr.mapping.map(joinAt);
        tr.insert(at, content);
        tr.setSelection(TextSelection.create(tr.doc, at));
    } else {
        tr.setSelection(TextSelection.create(tr.doc, textEnd(tr.doc, prev.pos + 1 + prev.node.content.size)));
    }
    dispatch(tr);
    return true;
}

/** Delete at the end of a cell pulls the next page's text up (mirror of Backspace). */
export function deleteAcrossPage(state, dispatch) {
    const $pos = caretAtCellEnd(state);
    if (!$pos) return false;
    const next = neighbourCell(state.doc, $pos, 1);
    if (!next) return false;
    const first = next.node.firstChild;
    const firstPos = next.pos + 1;
    if (!dispatch) return true;
    const tr = state.tr;
    const caret = $pos.pos;
    if (first.isTextblock && first.content.size > 0 && first.attrs.cont) {
        const text = first.textContent;
        const seg = typeof Intl !== 'undefined' && Intl.Segmenter
            ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)][0]?.segment.length ?? 1
            : 1;
        tr.delete(firstPos + 1, firstPos + 1 + Math.min(seg, first.content.size));
    } else if (first.isTextblock && $pos.parent.isTextblock) {
        const only = next.node.childCount === 1;
        if (only) tr.replaceWith(firstPos, firstPos + first.nodeSize, state.schema.nodes.paragraph.create());
        else tr.delete(firstPos, firstPos + first.nodeSize);
        tr.insert(caret, first.content);
    } else {
        return false;
    }
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(caret, -1)));
    dispatch(tr);
    return true;
}

/** Arrow keys at a cell edge move to the same column on the next/previous page. */
function arrowAcrossPage(dir, vertical) {
    return ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const $pos = selection.$head;
        if (!atCellEdgeBlock($pos, dir)) return false;
        if (vertical) {
            if (!view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
        } else if (dir < 0 ? $pos.parentOffset !== 0 : $pos.parentOffset !== $pos.parent.content.size) {
            return false;
        }
        const target = neighbourCell(state.doc, $pos, dir);
        if (!target) return false;
        const { start, end } = cellContentRange(target);
        let pos = dir > 0 ? textStart(state.doc, start) : textEnd(state.doc, end);
        if (vertical) {
            // Keep the caret's horizontal position, like moving between lines.
            const here = view.coordsAtPos($pos.pos);
            const edge = view.coordsAtPos(pos);
            const hit = view.posAtCoords({ left: here.left, top: (edge.top + edge.bottom) / 2 });
            if (hit && cellStart(state.doc.resolve(hit.pos)) === target.pos) pos = hit.pos;
        }
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
        return true;
    };
}

/** Select the current cell's content (instead of the whole multi-page doc). */
function selectCell({ editor }) {
    const { state, view } = editor;
    const range = cellRangeAt(state.selection.$head);
    if (!range) return false;
    const from = textStart(state.doc, range.from);
    const to = textEnd(state.doc, range.to);
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    return true;
}

/** Clamp a selection to the cell its anchor is in. */
function clampSelection(state) {
    const sel = state.selection;
    if (sel instanceof AllSelection) {
        const range = cellRangeAt(TextSelection.near(state.doc.resolve(0)).$head);
        if (!range) return null;
        return TextSelection.create(state.doc, textStart(state.doc, range.from), textEnd(state.doc, range.to));
    }
    if (!(sel instanceof TextSelection) || sel.empty) return null;
    const a = cellStart(sel.$anchor);
    const h = cellStart(sel.$head);
    if (a === h) return null;
    const range = cellRangeAt(sel.$anchor);
    if (!range) return null;
    const head = sel.head > sel.anchor ? textEnd(state.doc, range.to) : textStart(state.doc, range.from);
    return TextSelection.create(state.doc, sel.anchor, head);
}

export const PageStructure = Extension.create({
    name: 'pageStructure',
    priority: 1000, // ahead of ListKeymap / base keymap

    addKeyboardShortcuts() {
        return {
            Backspace: ({ editor }) => backspaceAcrossPage(editor.state, editor.view.dispatch),
            Delete: ({ editor }) => deleteAcrossPage(editor.state, editor.view.dispatch),
            ArrowUp: arrowAcrossPage(-1, true),
            ArrowDown: arrowAcrossPage(1, true),
            ArrowLeft: arrowAcrossPage(-1, false),
            ArrowRight: arrowAcrossPage(1, false),
            'Mod-a': selectCell,
        };
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('bpStructure'),
                filterTransaction(tr) {
                    if (!tr.docChanged || isExempt(tr)) return true;
                    return stepsStayInCells(tr);
                },
                appendTransaction(_trs, _old, state) {
                    const clamped = clampSelection(state);
                    return clamped ? state.tr.setSelection(clamped) : null;
                },
                props: {
                    handleDOMEvents: {
                        // Android keyboards report Backspace as keyCode 229, so
                        // the keymap never sees it; catch the edit intent instead.
                        beforeinput(view, event) {
                            const e = /** @type {InputEvent} */ (event);
                            const cmd = e.inputType === 'deleteContentBackward'
                                ? backspaceAcrossPage
                                : e.inputType === 'deleteContentForward' ? deleteAcrossPage : null;
                            if (!cmd || !cmd(view.state, null)) return false;
                            e.preventDefault();
                            cmd(view.state, view.dispatch);
                            return true;
                        },
                    },
                },
            }),
        ];
    },
});
