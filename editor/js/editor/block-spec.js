/**
 * Compact block specs for tests, shared by the unit-test helpers
 * (./test-helpers.js) and the e2e hooks (./test-hooks.js, `window.__bpTest`):
 *
 *   'text'                                  → paragraph ('' → blank line)
 *   { t: 'text', cont, align }              → paragraph (cont = continuation)
 *   { ol: ['a', 'b'], start, cont }         → ordered list
 *   { table: [['h1','h2'], ['a','b']], header, cont }
 *                                           → table (header: first row is <th>)
 *   { img: 'data:…', width }                → image (width: % of the column)
 */

/** ProseMirror JSON for one block spec. */
export function blockJSON(b) {
    if (typeof b === 'string') return b ? { type: 'paragraph', content: [{ type: 'text', text: b }] } : { type: 'paragraph' };
    if (b.ol) {
        return {
            type: 'orderedList',
            attrs: { start: b.start ?? 1, cont: Boolean(b.cont) },
            content: b.ol.map((t) => ({ type: 'listItem', content: [blockJSON(t)] })),
        };
    }
    if (b.table) {
        return {
            type: 'table',
            attrs: { cont: Boolean(b.cont) },
            content: b.table.map((row, i) => ({
                type: 'tableRow',
                content: row.map((text) => ({
                    type: b.header && i === 0 ? 'tableHeader' : 'tableCell',
                    content: [blockJSON(text)],
                })),
            })),
        };
    }
    if (b.img) return { type: 'image', attrs: { src: b.img, width: b.width ?? null } };
    return {
        type: 'paragraph',
        attrs: { cont: Boolean(b.cont), textAlign: b.align ?? null },
        content: b.t ? [{ type: 'text', text: b.t }] : undefined,
    };
}

/** Table text by row: "h1,h2/a,b"; a header row is marked "#". */
export function tableText(table) {
    const rows = [];
    table.forEach((row) => {
        const cells = [];
        row.forEach((cell) => cells.push(cell.textContent));
        const header = row.childCount && row.firstChild.type.name === 'tableHeader';
        rows.push((header ? '#' : '') + cells.join(','));
    });
    return rows.join('/');
}
