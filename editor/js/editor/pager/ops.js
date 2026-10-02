/**
 * Document operations the pager performs. Pure transaction builders: given a
 * Transaction they add steps; measurement decides *which* op to run
 * (./measure.js), never these functions.
 *
 * Every op keeps the user's selection on the same characters: moving text is
 * a delete + insert, and a plain delete would map a caret inside the moved
 * range to the deletion point. `moveBlocks` remaps it explicitly.
 */
import { Fragment, TextSelection, Selection, canJoin } from '../tiptap.js';
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
    return { anchor, head, stored: tr.storedMarks, stepStart: tr.steps.length, isText: tr.selection instanceof TextSelection };
}

function setSelectionSafe(tr, anchor, head) {
    const size = tr.doc.content.size;
    const a = Math.max(0, Math.min(anchor, size));
    const h = Math.max(0, Math.min(head, size));
    const $a = tr.doc.resolve(a);
    const $h = tr.doc.resolve(h);
    if ($a.parent.inlineContent && $h.parent.inlineContent) {
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
    setSelectionSafe(tr, remap(cap.anchor), remap(cap.head));
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
    const next = pages[pageIndex + 1];
    if (!next) {
        const at = map(page.pos + page.node.nodeSize);
        tr.insert(at, template.createPage(schema, { [col]: frag }, tr.doc.nodeAt(map(page.pos))));
        insertAt = collectPages(tr.doc)[pageIndex + 1].cells[col].pos + 1;
    } else {
        const tgt = next.cells[col];
        const s = map(tgt.pos + 1);
        if (isBlankCell(tgt.node)) tr.replaceWith(s, s + tgt.node.content.size, frag);
        else tr.insert(s, frag);
        insertAt = s;
    }
    restoreSelection(tr, cap, from, end, insertAt);
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
    if (isBlankCell(cur.node)) {
        insertAt = cur.pos + 1;
        tr.replaceWith(insertAt, insertAt + cur.node.content.size, Fragment.from(first));
    } else {
        insertAt = cur.pos + 1 + cur.node.content.size;
        tr.insert(insertAt, first);
    }
    restoreSelection(tr, cap, from, to, insertAt);
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
