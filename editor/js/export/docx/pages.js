/**
 * Pages → Word body.
 *
 *   letter  one column; the pager's page cuts are dropped and every `cont`
 *           piece re-joined, so Word paginates the flow itself.
 *   diary   a bordered two-column table (20% | 80%), one row per editor page.
 *           A page with a header starts a new Word page with the header block
 *           and the column-titles row; pages without one continue the table.
 *           The page-edge pieces stay in their own page's row (a row can split
 *           across Word pages, so nothing is lost or reordered).
 */
import { Paragraph, Table, TableRow, TableCell, WidthType, TableLayoutType } from '../../../vendor/docx/docx.esm.js';
import { blocksToWord, ensureChildren, TABLE_BORDERS } from './blocks.js';
import { mergeContinuations, columnBlocks } from './merge-cont.js';
import { headerBlock, titlesRow } from './header.js';
import { CONTENT_WIDTH, LEFT_COL_PCT } from './constants.js';

/** Node types handled by this module (see the coverage test). */
export const PAGE_TYPES = ['doc', 'letterPage', 'diaryPage', 'flowCell'];

const LEFT_TWIPS = Math.round((CONTENT_WIDTH * LEFT_COL_PCT) / 100);
const RIGHT_TWIPS = CONTENT_WIDTH - LEFT_TWIPS;

export function letterBody(docJSON, ctx) {
    const blocks = mergeContinuations(columnBlocks(docJSON, 'main'));
    return ensureChildren(blocksToWord(blocks, { ...ctx, widthTwips: CONTENT_WIDTH }));
}

function cellBlocks(page, col) {
    const cell = (page.content || []).find((c) => c.type === 'flowCell' && c.attrs?.col === col);
    return cell?.content || [];
}

function bodyCell(blocks, widthTwips, ctx) {
    return new TableCell({
        width: { size: widthTwips, type: WidthType.DXA },
        children: ensureChildren(blocksToWord(blocks, { ...ctx, widthTwips })),
    });
}

function bodyTable(rows) {
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [LEFT_TWIPS, RIGHT_TWIPS],
        layout: TableLayoutType.FIXED,
        borders: TABLE_BORDERS,
        rows,
    });
}

const spacer = () => new Paragraph({ spacing: { after: 0, line: 240 } });

export function diaryBody(docJSON, ctx) {
    const out = [];
    let rows = [];
    const flush = () => {
        if (!rows.length) return;
        out.push(bodyTable(rows), spacer());
        rows = [];
    };

    (docJSON.content || []).forEach((page, index) => {
        if (page.attrs?.hasHeader) {
            flush();
            const fields = page.attrs.fields || {};
            out.push(headerBlock(fields, { pageBreakBefore: index > 0 }), spacer());
            rows.push(titlesRow(fields, LEFT_TWIPS, RIGHT_TWIPS));
        }
        rows.push(new TableRow({
            children: [
                bodyCell(cellBlocks(page, 'left'), LEFT_TWIPS, ctx),
                bodyCell(cellBlocks(page, 'right'), RIGHT_TWIPS, ctx),
            ],
        }));
    });
    flush();
    return out;
}
