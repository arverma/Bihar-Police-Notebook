/**
 * Read-only views over the paged document: where each page and cell sits.
 * Pure functions of a ProseMirror doc — no DOM.
 */

/**
 * @typedef {{ pos: number, node: import('prosemirror-model').Node, col: string }} CellInfo
 * @typedef {{ pos: number, node: import('prosemirror-model').Node, index: number, cells: Record<string, CellInfo> }} PageInfo
 */

/**
 * Every page with its flow cells keyed by column.
 * `pos` values are document positions *before* the node.
 * @param {import('prosemirror-model').Node} doc
 * @returns {PageInfo[]}
 */
export function collectPages(doc) {
    /** @type {PageInfo[]} */
    const pages = [];
    doc.forEach((page, offset, index) => {
        /** @type {Record<string, CellInfo>} */
        const cells = {};
        page.descendants((node, rel) => {
            if (node.type.name === 'flowCell') {
                cells[node.attrs.col] = { pos: offset + 1 + rel, node, col: node.attrs.col };
                return false;
            }
            return true;
        });
        pages.push({ pos: offset, node: page, index, cells });
    });
    return pages;
}

/** Content range of a cell: [start, end) covers its blocks. */
export function cellContentRange(cell) {
    const start = cell.pos + 1;
    return { start, end: start + cell.node.content.size };
}

/** Children of a cell with their document positions. */
export function cellBlocks(cell) {
    const out = [];
    let pos = cell.pos + 1;
    cell.node.forEach((node) => {
        out.push({ pos, node });
        pos += node.nodeSize;
    });
    return out;
}

/** A cell holding only one empty, non-continuation paragraph. */
export function isBlankCell(cellNode) {
    if (cellNode.childCount !== 1) return false;
    const only = cellNode.firstChild;
    return only.type.name === 'paragraph' && only.content.size === 0 && !only.attrs.cont;
}

/**
 * Locate the page/column/cell holding a document position.
 * @returns {{ page: PageInfo, cell: CellInfo } | null}
 */
export function locate(doc, pos) {
    const pages = collectPages(doc);
    for (const page of pages) {
        if (pos < page.pos || pos > page.pos + page.node.nodeSize) continue;
        for (const cell of Object.values(page.cells)) {
            const { start, end } = cellContentRange(cell);
            if (pos >= start && pos <= end) return { page, cell };
        }
        return { page, cell: null };
    }
    return null;
}

/** Index of the page containing `pos`, clamped to a valid page. */
export function pageIndexAt(doc, pos) {
    let idx = 0;
    doc.forEach((page, offset, index) => {
        if (pos >= offset) idx = index;
    });
    return idx;
}
