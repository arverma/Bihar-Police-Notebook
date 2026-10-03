/**
 * Tables in a writing box.
 *
 * A table is a direct child of a flowCell. When it does not fit, the pager
 * cuts it between rows (../pager/ops.js `splitTable`): the rows below the
 * cut become a continuation table (`cont`) at the top of the same column on
 * the next page. The pieces of one table are its "chain".
 *
 *  - Column changes, the header-row toggle and Delete table apply to every
 *    piece of the chain, so the pieces always share one column layout and
 *    re-join cleanly.
 *  - A continuation repeats the chain's header row above its own rows. The
 *    repeat is drawn by the node view from a decoration — it is never in the
 *    document, so moving the page boundary can never change the table.
 *  - Tab / Shift+Tab move cell to cell across the pieces; Tab in the very last
 *    cell adds a row.
 */
import {
    Table,
    TableRow,
    TableCell,
    TableHeader,
    Plugin,
    PluginKey,
    Decoration,
    DecorationSet,
    DOMSerializer,
    Selection,
    TableMap,
    selectedRect,
    isInTable,
    addColumn,
    removeColumn,
    goToNextCell,
} from './tiptap.js';
import { collectPages } from './pager/layout.js';
import { isHeaderRow } from './pager/ops.js';
import { insertBlock } from './insert-block.js';

/** Cell content: text and lists; images and nested tables stay outside. */
const CELL_CONTENT = '(paragraph | bulletList | orderedList)+';

/** Default size of a new table (the header row is the first of the rows). */
export const NEW_TABLE = { rows: 3, cols: 3 };

/**
 * Every piece of the table at `tablePos`, in reading order.
 * @returns {{ pos: number, node: any }[]}
 */
export function tablePieces(doc, tablePos) {
    const node = doc.nodeAt(tablePos);
    const $p = doc.resolve(tablePos);
    if (!node || $p.parent.type.name !== 'flowCell') return node ? [{ pos: tablePos, node }] : [];
    const col = $p.parent.attrs.col;
    const pages = collectPages(doc);
    const cellOf = (i) => pages[i]?.cells[col];
    const isFirst = (piece, cell) => piece.pos === cell.pos + 1;
    const isLast = (piece, cell) => piece.pos + piece.node.nodeSize === cell.pos + 1 + cell.node.content.size;

    const start = $p.index(0);
    const pieces = [{ pos: tablePos, node, page: start }];
    // Back through continuations to the table's first piece.
    for (let cur = pieces[0]; cur.node.attrs.cont && isFirst(cur, cellOf(cur.page));) {
        const prev = cellOf(cur.page - 1);
        const last = prev?.node.lastChild;
        if (!last || last.type !== node.type) break;
        cur = { pos: prev.pos + 1 + prev.node.content.size - last.nodeSize, node: last, page: cur.page - 1 };
        pieces.unshift(cur);
    }
    // Forward while the next page opens with this table's continuation.
    for (let cur = pieces[pieces.length - 1]; isLast(cur, cellOf(cur.page));) {
        const next = cellOf(cur.page + 1);
        const first = next?.node.firstChild;
        if (!first || first.type !== node.type || !first.attrs.cont) break;
        cur = { pos: next.pos + 1, node: first, page: cur.page + 1 };
        pieces.push(cur);
    }
    return pieces.map(({ pos, node: n }) => ({ pos, node: n }));
}

/** Position before the table holding the selection. */
function currentTablePos(state) {
    return selectedRect(state).tableStart - 1;
}

/** Remove one piece; a box left empty keeps a blank line. */
function removePiece(tr, piece) {
    const $p = tr.doc.resolve(piece.pos);
    const size = tr.doc.nodeAt(piece.pos).nodeSize;
    if ($p.parent.childCount === 1) tr.replaceWith(piece.pos, piece.pos + size, tr.doc.type.schema.nodes.paragraph.create());
    else tr.delete(piece.pos, piece.pos + size);
}

/**
 * A selection at `pos`, searching toward the block that is still there, so
 * the caret never leaves the writing box (a forward search from the end of
 * a box would land in the next column or page).
 */
function nearInCell(doc, pos) {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    const dir = $pos.parent.type.name === 'flowCell' && $pos.index() >= $pos.parent.childCount ? -1 : 1;
    return Selection.near($pos, dir);
}

/** Put the caret back inside the table if a removal left it outside. */
function keepCaretNear(tr, pos) {
    if (!isInTable({ selection: tr.selection })) tr.setSelection(nearInCell(tr.doc, tr.mapping.map(pos)));
}

/** Delete every piece of the table holding the selection. */
function deleteTableChain(state, tr) {
    const pieces = tablePieces(state.doc, currentTablePos(state));
    const first = pieces[0].pos;
    for (let i = pieces.length - 1; i >= 0; i--) removePiece(tr, pieces[i]);
    tr.setSelection(nearInCell(tr.doc, first));
}

/** Add a column on `side` of the selection to every piece. */
function addColumnToChain(side) {
    return () => ({ state, tr, dispatch }) => {
        if (!isInTable(state)) return false;
        if (!dispatch) return true;
        const rect = selectedRect(state);
        const col = side < 0 ? rect.left : rect.right;
        const pieces = tablePieces(state.doc, rect.tableStart - 1);
        // Last piece first: earlier positions stay valid.
        for (let i = pieces.length - 1; i >= 0; i--) {
            const { pos } = pieces[i];
            const table = tr.doc.nodeAt(pos);
            const map = TableMap.get(table);
            addColumn(tr, { map, tableStart: pos + 1, table }, Math.min(col, map.width));
        }
        return true;
    };
}

export const FlowTable = Table.extend({
    // Not in the `block` group: a table lives directly in a writing box
    // (flowCell lists it by name), never in a list item or another table.
    group: 'flowBlock',

    addOptions() {
        return { ...this.parent?.(), resizable: false, allowTableNodeSelection: false };
    },

    addAttributes() {
        return {
            ...this.parent?.(),
            cont: {
                default: false,
                parseHTML: (el) => el.getAttribute('data-cont') === 'true',
                renderHTML: (attrs) => (attrs.cont ? { 'data-cont': 'true' } : {}),
            },
        };
    },

    addNodeView() {
        return ({ node, decorations }) => new FlowTableView(node, decorations);
    },

    addCommands() {
        return {
            ...this.parent?.(),
            /** Insert a 3×3 table with a header row at the selection. */
            insertFlowTable: () => ({ state, tr, dispatch }) => {
                if (isInTable(state)) return false;
                const { table, tableRow, tableCell, tableHeader, paragraph } = state.schema.nodes;
                const row = (type) => tableRow.create(null, Array.from({ length: NEW_TABLE.cols }, () => type.create(null, paragraph.create())));
                const rows = [row(tableHeader)];
                for (let i = 1; i < NEW_TABLE.rows; i++) rows.push(row(tableCell));
                const node = table.create(null, rows);
                if (!dispatch) return Boolean(node);
                return insertBlock(tr, node);
            },
            addColumnBefore: addColumnToChain(-1),
            addColumnAfter: addColumnToChain(1),
            deleteColumn: () => ({ state, tr, dispatch }) => {
                if (!isInTable(state)) return false;
                const rect = selectedRect(state);
                if (rect.left === 0 && rect.right === rect.map.width) {
                    if (dispatch) deleteTableChain(state, tr);
                    return true;
                }
                if (!dispatch) return true;
                const tablePos = rect.tableStart - 1;
                const pieces = tablePieces(state.doc, tablePos);
                for (let i = pieces.length - 1; i >= 0; i--) {
                    const { pos } = pieces[i];
                    for (let c = rect.right - 1; c >= rect.left; c--) {
                        const table = tr.doc.nodeAt(pos);
                        const map = TableMap.get(table);
                        if (c < map.width) removeColumn(tr, { map, tableStart: pos + 1, table }, c);
                    }
                }
                keepCaretNear(tr, tablePos + 1);
                return true;
            },
            deleteRow: () => (props) => {
                const { state, tr, dispatch } = props;
                if (!isInTable(state)) return false;
                const rect = selectedRect(state);
                if (rect.top > 0 || rect.bottom < rect.map.height) return this.parent?.().deleteRow()(props);
                // Every row of this piece: drop the piece, or the table if it is the only one.
                const pieces = tablePieces(state.doc, rect.tableStart - 1);
                if (!dispatch) return true;
                if (pieces.length === 1) {
                    deleteTableChain(state, tr);
                    return true;
                }
                const index = pieces.findIndex((p) => p.pos === rect.tableStart - 1);
                const next = pieces[index + 1];
                // The piece after a removed first piece starts the table now.
                if (index === 0 && next) tr.setNodeMarkup(next.pos, null, { ...next.node.attrs, cont: false });
                removePiece(tr, pieces[index]);
                keepCaretNear(tr, pieces[index].pos);
                return true;
            },
            deleteTable: () => ({ state, tr, dispatch }) => {
                if (!isInTable(state)) return false;
                if (dispatch) deleteTableChain(state, tr);
                return true;
            },
            /** Toggle the header row: the first row of the table's first piece. */
            toggleHeaderRow: () => ({ state, tr, dispatch }) => {
                if (!isInTable(state)) return false;
                if (!dispatch) return true;
                const origin = tablePieces(state.doc, currentTablePos(state))[0];
                const row = origin.node.firstChild;
                const { tableCell, tableHeader } = state.schema.nodes;
                const type = isHeaderRow(row) ? tableCell : tableHeader;
                row.forEach((cell, offset) => tr.setNodeMarkup(origin.pos + 2 + offset, type, cell.attrs));
                return true;
            },
        };
    },

    addKeyboardShortcuts() {
        const step = (dir) => () => {
            const ed = this.editor;
            const { state } = ed;
            if (!isInTable(state)) return false;
            if (goToNextCell(dir)(state, ed.view.dispatch)) return true;
            // Past this piece's edge: continue in the neighbouring piece.
            const pieces = tablePieces(state.doc, currentTablePos(state));
            const index = pieces.findIndex((p) => p.pos === currentTablePos(state));
            const target = pieces[index + dir];
            if (target) {
                const $edge = dir > 0
                    ? state.doc.resolve(target.pos + 1)
                    : state.doc.resolve(target.pos + target.node.nodeSize - 1);
                ed.view.dispatch(state.tr.setSelection(Selection.near($edge, dir)));
                return true;
            }
            // Shift+Tab in the very first cell leaves the table, as before.
            if (dir < 0 || !ed.can().addRowAfter()) return false;
            return ed.chain().addRowAfter().goToNextCell().run();
        };
        return {
            ...this.parent?.(),
            Tab: step(1),
            'Shift-Tab': step(-1),
        };
    },

    addProseMirrorPlugins() {
        return [...(this.parent?.() || []), repeatHeaderPlugin()];
    },
});

export const FlowTableRow = TableRow;
export const FlowTableCell = TableCell.extend({ content: CELL_CONTENT });
export const FlowTableHeader = TableHeader.extend({ content: CELL_CONTENT });

/** Stable small ids for header rows, so a changed header re-renders its repeats. */
const rowIds = new WeakMap();
let nextRowId = 1;
function rowId(row) {
    if (!rowIds.has(row)) rowIds.set(row, nextRowId++);
    return rowIds.get(row);
}

/**
 * Decorate each continuation piece with the header row of its chain.
 * ProseMirror compares node decorations by their attributes only, so the
 * row's id goes in an attribute; the row itself rides in the spec.
 */
function repeatHeaderPlugin() {
    return new Plugin({
        key: new PluginKey('bpTableRepeatHeader'),
        props: {
            decorations(state) {
                const decos = [];
                for (const page of collectPages(state.doc)) {
                    if (page.index === 0) continue;
                    for (const cell of Object.values(page.cells)) {
                        const first = cell.node.firstChild;
                        if (first?.type.name !== 'table' || !first.attrs.cont) continue;
                        const pos = cell.pos + 1;
                        const origin = tablePieces(state.doc, pos)[0];
                        const header = origin.node.firstChild;
                        if (origin.pos === pos || !isHeaderRow(header)) continue;
                        decos.push(Decoration.node(pos, pos + first.nodeSize, {
                            'data-repeat-header': String(rowId(header)),
                        }, { repeatHeader: header }));
                    }
                }
                return DecorationSet.create(state.doc, decos);
            },
        },
    });
}

/**
 * <div.bp-table><table>[<thead repeat>]<tbody contentDOM/></table></div>
 * No colgroup: columns share the width equally (table-layout: fixed), so
 * every piece of a split table lines up.
 */
class FlowTableView {
    constructor(node, decorations) {
        this.node = node;
        this.dom = document.createElement('div');
        this.dom.className = 'bp-table';
        this.table = this.dom.appendChild(document.createElement('table'));
        this.contentDOM = this.table.appendChild(document.createElement('tbody'));
        this.thead = null;
        this.repeatRow = null;
        this.syncRepeat(decorations);
    }

    syncRepeat(decorations) {
        const row = decorations.find((d) => d.spec?.repeatHeader)?.spec.repeatHeader ?? null;
        if (row === this.repeatRow) return;
        this.repeatRow = row;
        this.thead?.remove();
        this.thead = null;
        if (!row) return;
        const thead = document.createElement('thead');
        thead.className = 'bp-table-repeat';
        thead.contentEditable = 'false';
        // Screen readers already read the header once, on the first piece.
        thead.setAttribute('aria-hidden', 'true');
        thead.appendChild(DOMSerializer.fromSchema(row.type.schema).serializeNode(row));
        this.table.insertBefore(thead, this.contentDOM);
        this.thead = thead;
    }

    update(node, decorations) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.syncRepeat(decorations);
        return true;
    }

    ignoreMutation(mutation) {
        if (mutation.type === 'selection') return false;
        return !this.contentDOM.contains(mutation.target);
    }
}

/** Whether the table holding the selection has a header row. */
export function tableHasHeaderRow(state) {
    if (!isInTable(state)) return false;
    const origin = tablePieces(state.doc, currentTablePos(state))[0];
    return isHeaderRow(origin?.node.firstChild);
}
