/**
 * Document operations the pager performs. Pure transaction builders: given a
 * Transaction they add steps; measurement decides *which* op to run
 * (./measure.js), never these functions.
 *
 * Every op keeps the user's selection on the same characters: moving text is
 * a delete + insert, and a plain delete would map a caret inside the moved
 * range to the deletion point. `moveBlocks` remaps it explicitly.
 */
import { Fragment, TextSelection, NodeSelection, Selection, canJoin } from '../tiptap.js';
import { collectPages, cellContentRange, isBlankCell } from './layout.js';

/** Transaction meta listing the moves an op made (see mapThroughPager). */
export const MOVES_META = 'bpPagerMoves';

/**
 * @typedef {object} PageTemplate
 * @property {string[]} columns        Column names in each page, in order.
 * @property {(schema: any, content: Record<string, Fragment>, prevPage: any) => any} createPage
 *           Build a new page node; `content[col]` fills that column's cell.
 * @property {(pageNode: any) => boolean} isRemovable
 *           Whether an otherwise-empty trailing page may be dropped.
 */

/** Selection anchor/head, and stored marks, before an op. */
function captureSelection(tr) {
    const { anchor, head } = tr.selection;
    return {
        anchor,
        head,
        stored: tr.storedMarks,
        stepStart: tr.steps.length,
        isText: tr.selection instanceof TextSelection,
        isNode: tr.selection instanceof NodeSelection,
    };
}

function setSelectionSafe(tr, anchor, head, isNode = false) {
    const size = tr.doc.content.size;
    const a = Math.max(0, Math.min(anchor, size));
    const h = Math.max(0, Math.min(head, size));
    const $a = tr.doc.resolve(a);
    const $h = tr.doc.resolve(h);
    // A selected image keeps its selection (and resize handle) when it moves.
    if (isNode && tr.doc.nodeAt(a) && NodeSelection.isSelectable(tr.doc.nodeAt(a))) {
        tr.setSelection(NodeSelection.create(tr.doc, a));
    } else if ($a.parent.inlineContent && $h.parent.inlineContent) {
        tr.setSelection(TextSelection.create(tr.doc, a, h));
    } else {
        tr.setSelection(Selection.near($h));
    }
}

/**
 * Put the selection back on the moved characters.
 * Positions inside [from, to] move to `insertAt + (pos - from)`; others map.
 */
function restoreSelection(tr, cap, from, to, insertAt) {
    const moves = tr.getMeta(MOVES_META) || [];
    tr.setMeta(MOVES_META, [...moves, { from, to, insertAt, stepStart: cap.stepStart, insertStep: tr.steps.length }]);
    const inside = (p) => p >= from && p <= to;
    if (!inside(cap.anchor) && !inside(cap.head)) return;
    const mapping = tr.mapping.slice(cap.stepStart);
    const remap = (p) => (inside(p) ? insertAt + (p - from) : mapping.map(p));
    setSelectionSafe(tr, remap(cap.anchor), remap(cap.head), cap.isNode);
    if (cap.stored) tr.setStoredMarks(cap.stored);
}

/**
 * A caret on the blank line of a box that an op fills (the line is replaced,
 * not kept) goes to the start of what filled it. Plain mapping would push it
 * past the replaced range into the next box — another column or page.
 * `blankFrom`/`blankTo` are pre-op positions; `insertAt` is post-op.
 */
function keepCaretInFilledBox(tr, cap, blankFrom, blankTo, insertAt) {
    const inBlank = (p) => p >= blankFrom && p <= blankTo;
    if (!inBlank(cap.anchor) || !inBlank(cap.head)) return;
    tr.setSelection(Selection.near(tr.doc.resolve(insertAt), 1));
    if (cap.stored) tr.setStoredMarks(cap.stored);
}

/**
 * Split a paragraph at `pos`; the tail becomes a continuation (`cont`).
 * @returns {number} position before the tail paragraph
 */
export function splitParagraph(tr, pos) {
    const $pos = tr.doc.resolve(pos);
    const para = $pos.parent;
    tr.split(pos, 1, [{ type: para.type, attrs: { ...para.attrs, cont: true } }]);
    return pos + 1;
}

/**
 * Split a list before item `itemIndex`; the tail list becomes a continuation
 * whose `start` keeps the numbering going.
 * @returns {number} position before the tail list
 */
export function splitList(tr, listPos, itemIndex) {
    const list = tr.doc.nodeAt(listPos);
    let pos = listPos + 1;
    for (let i = 0; i < itemIndex; i++) pos += list.child(i).nodeSize;
    const attrs = { ...list.attrs, cont: true };
    if (list.type.name === 'orderedList') attrs.start = (list.attrs.start ?? 1) + itemIndex;
    tr.split(pos, 1, [{ type: list.type, attrs }]);
    return pos + 1;
}

/** A row made only of header cells. */
export function isHeaderRow(row) {
    return Boolean(row) && row.childCount > 0 && row.content.content.every((c) => c.type.name === 'tableHeader');
}

/**
 * Fewest rows the first piece of a table may keep on a page: a header row is
 * never left alone at a page bottom, it goes with at least one body row.
 */
export function tableMinRows(table) {
    return !table.attrs.cont && table.childCount > 1 && isHeaderRow(table.firstChild) ? 2 : 1;
}

/**
 * Row index to cut a table before: the last boundary at or before `rowIndex`
 * that no rowspan crosses and that keeps at least `minRows` rows before it.
 * @returns {number} a row index >= 1, or -1 when the table cannot be cut
 */
export function tableCutIndex(table, rowIndex, minRows = 1) {
    const safe = [];
    let reach = 0; // first row not covered by a rowspan from the rows above
    for (let i = 0; i < table.childCount; i++) {
        safe[i] = reach <= i;
        table.child(i).forEach((cell) => {
            reach = Math.max(reach, i + (cell.attrs.rowspan || 1));
        });
    }
    for (let i = Math.min(rowIndex, table.childCount - 1); i >= Math.max(1, minRows); i--) {
        if (safe[i]) return i;
    }
    return -1;
}

/**
 * Split a table before row `rowIndex`; the tail table becomes a
 * continuation (its header row is repeated on screen and paper, never in
 * the document — see ../tables.js).
 * @returns {number} position before the tail table
 */
export function splitTable(tr, tablePos, rowIndex) {
    const table = tr.doc.nodeAt(tablePos);
    let pos = tablePos + 1;
    for (let i = 0; i < rowIndex; i++) pos += table.child(i).nodeSize;
    tr.split(pos, 1, [{ type: table.type, attrs: { ...table.attrs, cont: true } }]);
    return pos + 1;
}

/**
 * Move blocks [from, end of cell) of page `pageIndex`/`col` to the start of
 * the same column on the next page, creating that page if needed.
 */
export function spillToNext(tr, template, pageIndex, col, from) {
    const pages = collectPages(tr.doc);
    const page = pages[pageIndex];
    const src = page.cells[col];
    const { end } = cellContentRange(src);
    if (from >= end) return tr;
    const frag = tr.doc.slice(from, end).content;
    const cap = captureSelection(tr);
    const schema = tr.doc.type.schema;

    const delStep = tr.steps.length;
    tr.delete(from, end);
    const map = (p) => tr.mapping.slice(delStep).map(p);

    let insertAt;
    let blank = null; // the next page's blank line this spill replaces
    const next = pages[pageIndex + 1];
    if (!next) {
        const at = map(page.pos + page.node.nodeSize);
        tr.insert(at, template.createPage(schema, { [col]: frag }, tr.doc.nodeAt(map(page.pos))));
        insertAt = collectPages(tr.doc)[pageIndex + 1].cells[col].pos + 1;
    } else {
        const tgt = next.cells[col];
        const s = map(tgt.pos + 1);
        if (isBlankCell(tgt.node)) {
            tr.replaceWith(s, s + tgt.node.content.size, frag);
            blank = { from: tgt.pos + 1, to: tgt.pos + 1 + tgt.node.content.size };
        } else {
            tr.insert(s, frag);
        }
        insertAt = s;
    }
    restoreSelection(tr, cap, from, end, insertAt);
    if (blank) keepCaretInFilledBox(tr, cap, blank.from, blank.to, insertAt);
    normalizeContinuations(tr);
    return tr;
}

/**
 * Move the first block of the next page's cell (same column) to the end of
 * this page's cell. A continuation re-joins the block it was cut from.
 */
export function absorbFromNext(tr, pageIndex, col) {
    const pages = collectPages(tr.doc);
    const cur = pages[pageIndex].cells[col];
    const nxt = pages[pageIndex + 1]?.cells[col];
    if (!nxt || isBlankCell(nxt.node)) return tr;
    const schema = tr.doc.type.schema;
    const first = nxt.node.firstChild;
    const from = nxt.pos + 1;
    const to = from + first.nodeSize;
    const cap = captureSelection(tr);

    // Remove from the later page first; `cur` sits before it and is unaffected.
    if (nxt.node.childCount === 1) tr.replaceWith(from, to, schema.nodes.paragraph.create());
    else tr.delete(from, to);

    let insertAt;
    const blank = isBlankCell(cur.node);
    if (blank) {
        insertAt = cur.pos + 1;
        tr.replaceWith(insertAt, insertAt + cur.node.content.size, Fragment.from(first));
    } else {
        insertAt = cur.pos + 1 + cur.node.content.size;
        tr.insert(insertAt, first);
    }
    restoreSelection(tr, cap, from, to, insertAt);
    // `cur` sits before the removed block, so its pre-op range is unchanged.
    if (blank) keepCaretInFilledBox(tr, cap, cur.pos + 1, cur.pos + 1 + cur.node.content.size, insertAt);
    normalizeContinuations(tr);
    return tr;
}

/**
 * Keep `cont` meaningful: only a cell's first block may carry it.
 * A continuation that is not first is joined to the block before it when the
 * two are joinable, otherwise the flag is dropped. The first page never
 * continues anything.
 */
export function normalizeContinuations(tr) {
    for (let guard = 0; guard < 10000; guard++) {
        const action = findContinuationFix(tr.doc);
        if (!action) return tr;
        if (action.kind === 'join') tr.join(action.pos);
        else tr.setNodeMarkup(action.pos, null, { ...tr.doc.nodeAt(action.pos).attrs, cont: false });
    }
    return tr;
}

function findContinuationFix(doc) {
    const pages = collectPages(doc);
    for (const page of pages) {
        for (const cell of Object.values(page.cells)) {
            let pos = cell.pos + 1;
            let prev = null;
            for (let i = 0; i < cell.node.childCount; i++) {
                const child = cell.node.child(i);
                if (child.attrs.cont) {
                    if (i === 0 && page.index === 0) return { kind: 'clear', pos };
                    if (i > 0) {
                        if (prev && prev.type === child.type && canJoin(doc, pos)) return { kind: 'join', pos };
                        return { kind: 'clear', pos };
                    }
                }
                prev = child;
                pos += child.nodeSize;
            }
        }
    }
    return null;
}

/**
 * Drop empty trailing pages after `keepIndex` (the page holding the caret,
 * so an Enter that just spilled a blank line keeps its page).
 */
export function collapseTrailingPages(tr, template, keepIndex) {
    for (;;) {
        const pages = collectPages(tr.doc);
        if (pages.length <= 1) return tr;
        const last = pages[pages.length - 1];
        if (last.index <= keepIndex) return tr;
        const blank = template.columns.every((c) => last.cells[c] && isBlankCell(last.cells[c].node));
        if (!blank || !template.isRemovable(last.node)) return tr;
        tr.delete(last.pos, last.pos + last.node.nodeSize);
    }
}

/**
 * Map a pre-transaction position through a pager transaction, following text
 * the pager moved (for callers holding a range across a reflow, e.g. the
 * transliteration word range). Plain `tr.mapping.map` would collapse a
 * position inside moved text onto the deletion point.
 */
export function mapThroughPager(tr, pos) {
    const moves = tr.getMeta(MOVES_META) || [];
    let p = pos;
    let step = 0;
    for (const m of moves) {
        p = tr.mapping.slice(step, m.stepStart).map(p);
        p = p >= m.from && p <= m.to
            ? m.insertAt + (p - m.from)
            : tr.mapping.slice(m.stepStart, m.insertStep).map(p);
        step = m.insertStep;
    }
    return tr.mapping.slice(step).map(p);
}
