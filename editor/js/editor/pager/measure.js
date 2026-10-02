/**
 * Geometry reads for the pager. Reads only — never writes to the DOM.
 *
 * All comparisons are rect-to-rect in viewport pixels, so they hold under the
 * screen-preview CSS transform (`--page-scale`): `s` converts the cell's
 * layout-pixel box (clientHeight, padding, line-height) into the same scaled
 * space that getBoundingClientRect / coordsAtPos report.
 */
import { cellBlocks } from './layout.js';

/** Sub-pixel slack so rounding never reports a fitting line as overflow. */
const EPS = 0.5;

/**
 * @typedef {object} CellMeasure
 * @property {number} limit      Viewport y of the bottom of the writing area.
 * @property {number} lineH      One line, in viewport px.
 * @property {number} slack      Free space below the last block (negative = overflow).
 * @property {boolean} overflow
 * @property {{pos:number, node:any, top:number, bottom:number}[]} blocks
 */

/**
 * @param {import('prosemirror-view').EditorView} view
 * @param {{pos:number, node:any}} cell
 * @returns {CellMeasure | null}
 */
export function measureCell(view, cell) {
    const el = cellElement(view, cell.pos);
    if (!el || !el.offsetHeight) return null;
    const rect = el.getBoundingClientRect();
    const s = rect.height / el.offsetHeight;
    const cs = getComputedStyle(el);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const lineH = (parseFloat(cs.lineHeight) || 24) * s;
    const limit = rect.top + (borderTop + el.clientHeight - padBottom) * s;
    const top = rect.top + (borderTop + padTop) * s;

    const blocks = cellBlocks(cell).map(({ pos, node }) => {
        const dom = view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) return { pos, node, top, bottom: top };
        const r = dom.getBoundingClientRect();
        const bcs = getComputedStyle(dom);
        return {
            pos,
            node,
            top: r.top - (parseFloat(bcs.marginTop) || 0) * s,
            bottom: r.bottom + (parseFloat(bcs.marginBottom) || 0) * s,
        };
    });
    const lastBottom = blocks.length ? blocks[blocks.length - 1].bottom : top;
    return { limit, lineH, slack: limit - lastBottom, overflow: lastBottom > limit + EPS, blocks };
}

/**
 * The writing box element of a cell. A diary cell renders inside table
 * wrappers, so its node DOM is the <td> and the box is the `.bp-cell` within.
 * @returns {HTMLElement | null}
 */
export function cellElement(view, pos) {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    if (dom.classList.contains('bp-cell')) return dom;
    return dom.querySelector('.bp-cell');
}

/** Index of the first block whose bottom crosses the limit, or -1. */
export function firstOverflowingBlock(m) {
    return m.blocks.findIndex((b) => b.bottom > m.limit + EPS);
}

/**
 * First position in a paragraph whose line does not fit above `limit`.
 *
 * A line fits when its whole line box does — not just its glyphs, which are
 * shorter than the line-height. Lines are a fixed height (CSS line-height),
 * so a position's line box is found from where its glyphs sit relative to
 * the paragraph top. The browser has already wrapped the text, so the result
 * is always the start of a rendered line — a valid, lossless cut.
 *
 * @param {number} paraTop viewport y of the paragraph's top edge
 * @param {number} lineH   line height in viewport px
 * @returns {number} a position in [start, end]; `start` means nothing fits
 */
export function firstNonFittingPos(view, blockPos, node, limit, paraTop, lineH) {
    const start = blockPos + 1;
    const end = start + node.content.size;
    const lineBottomAt = (p) => {
        const top = view.coordsAtPos(p, 1).top;
        const index = Math.max(0, Math.floor((top - paraTop + EPS) / lineH));
        return paraTop + (index + 1) * lineH;
    };
    const overflows = (p) => lineBottomAt(p) > limit + EPS;
    if (overflows(start)) return start;
    let lo = start;
    let hi = end;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (overflows(mid)) hi = mid;
        else lo = mid + 1;
    }
    return snapToGrapheme(view.state.doc, hi);
}

/**
 * Never split inside a grapheme cluster (Devanagari conjuncts, emoji). Lines
 * normally wrap at word boundaries already; this guards `overflow-wrap:
 * anywhere` breaks inside one long word.
 */
function snapToGrapheme(doc, pos) {
    if (typeof Intl === 'undefined' || !Intl.Segmenter) return pos;
    const $pos = doc.resolve(pos);
    const node = $pos.parent.maybeChild($pos.index());
    if (!node || !node.isText) return pos;
    const offsetInNode = pos - ($pos.start() + offsetOfChild($pos.parent, $pos.index()));
    if (offsetInNode <= 0) return pos;
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let boundary = 0;
    for (const { index } of seg.segment(node.text)) {
        if (index > offsetInNode) break;
        boundary = index;
    }
    return pos - (offsetInNode - boundary);
}

function offsetOfChild(parent, index) {
    let off = 0;
    for (let i = 0; i < index; i++) off += parent.child(i).nodeSize;
    return off;
}

/**
 * Index of the first list item whose bottom crosses the limit, or -1.
 */
export function firstOverflowingItem(view, listPos, listNode, limit) {
    let pos = listPos + 1;
    for (let i = 0; i < listNode.childCount; i++) {
        const dom = view.nodeDOM(pos);
        if (dom instanceof HTMLElement && dom.getBoundingClientRect().bottom > limit + EPS) return i;
        pos += listNode.child(i).nodeSize;
    }
    return -1;
}

/** Height (viewport px) of a block in the next cell, for absorb decisions. */
export function blockHeight(view, pos, node) {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return Infinity;
    if (node.type.name === 'orderedList' || node.type.name === 'bulletList') {
        const item = view.nodeDOM(pos + 1);
        if (item instanceof HTMLElement) return item.getBoundingClientRect().height;
    }
    return dom.getBoundingClientRect().height;
}
