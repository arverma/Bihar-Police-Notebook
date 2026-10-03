/**
 * Re-join blocks the pager cut at a page edge.
 *
 * The pager splits a paragraph, list or table at the bottom of a page and
 * tags the tail `cont` ("continues the last block of the previous page in
 * this column"). In Word the page boundary is wherever Word puts it, so the
 * pieces become one block again. Only `cont` blocks are joined — separate
 * paragraphs never are.
 *
 * Pure functions over doc JSON; inputs are not mutated.
 */

const JOINABLE = new Set(['paragraph', 'bulletList', 'orderedList', 'table']);

/** The block with its `cont` flag cleared. */
function withoutCont(block) {
    if (!block.attrs || !('cont' in block.attrs)) return block;
    const { cont, ...attrs } = block.attrs;
    return { ...block, attrs };
}

/**
 * @param {Array<object>} blocks blocks of one column, in reading order
 * @returns {Array<object>} blocks with every continuation joined to its predecessor
 */
export function mergeContinuations(blocks) {
    const out = [];
    for (const block of blocks || []) {
        const prev = out[out.length - 1];
        if (block.attrs?.cont && prev && prev.type === block.type && JOINABLE.has(block.type)) {
            out[out.length - 1] = { ...prev, content: [...(prev.content || []), ...(block.content || [])] };
        } else {
            out.push(withoutCont(block));
        }
    }
    return out;
}

/** Blocks of every flowCell of a given column across all pages, in order. */
export function columnBlocks(docJSON, col) {
    const out = [];
    for (const page of docJSON?.content || []) {
        for (const cell of page.content || []) {
            if (cell.type === 'flowCell' && (cell.attrs?.col ?? 'main') === col) out.push(...(cell.content || []));
        }
    }
    return out;
}
