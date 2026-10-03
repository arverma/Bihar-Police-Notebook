/**
 * Block nodes (paragraph, lists, image, table) → Word paragraphs and tables.
 *
 * Every mapper takes a `ctx`:
 *   warn(msg)     record something that could not be mapped faithfully
 *   widthTwips    width of the box the blocks sit in (images, table columns)
 *   ordered(n)    numbering reference for a fresh ordered list starting at n
 */
import {
    Paragraph,
    Table,
    TableRow,
    TableCell,
    ImageRun,
    AlignmentType,
    WidthType,
    BorderStyle,
    TableLayoutType,
} from '../../../vendor/docx/docx.esm.js';
import { inlineRuns, plainText } from './inline.js';
import { readImage } from './image-info.js';
import { CELL_PADDING, TWIPS_PER_PX, LINE_SPACING } from './constants.js';

/** Node types handled by this module (see the coverage test). */
export const BLOCK_TYPES = [
    'paragraph', 'bulletList', 'orderedList', 'listItem', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader',
];

const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
};

const SPACING = { line: LINE_SPACING, after: 0 };
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
export const TABLE_BORDERS = {
    top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER,
};

/** Left indent of a list item at nesting `level`, in twips. */
const listIndent = (level) => 720 * (level + 1);

export function paragraph(node, ctx, opts = {}) {
    return new Paragraph({
        children: inlineRuns(node.content, ctx, opts.base),
        alignment: ALIGN[node.attrs?.textAlign],
        spacing: SPACING,
        numbering: opts.numbering,
        indent: opts.indent,
        pageBreakBefore: opts.pageBreakBefore,
    });
}

function imageBlock(node, ctx) {
    const info = readImage(node.attrs?.src);
    const label = node.attrs?.alt || node.attrs?.title || '';
    if (!info) {
        ctx.warn('An image could not be read and was left out of the Word file.');
        return [new Paragraph({ children: inlineRuns([{ type: 'text', text: label ? `[${label}]` : '[image]' }], ctx), spacing: SPACING })];
    }
    const boxPx = Math.max(1, (ctx.widthTwips - CELL_PADDING) / TWIPS_PER_PX);
    const pct = Number(node.attrs?.width);
    // Saved width is a percentage of the box; none means natural size, never wider than the box.
    const width = Math.max(1, Math.round(pct > 0 ? (boxPx * pct) / 100 : Math.min(info.width, boxPx)));
    const height = Math.max(1, Math.round((width * info.height) / info.width));
    return [new Paragraph({
        spacing: SPACING,
        children: [new ImageRun({
            type: info.type,
            data: info.data,
            transformation: { width, height },
            altText: { name: label || 'image', description: node.attrs?.alt || '', title: node.attrs?.title || '' },
        })],
    })];
}

function listBlocks(list, ctx, level) {
    const ordered = list.type === 'orderedList';
    const reference = ordered ? ctx.ordered(list.attrs?.start ?? 1) : 'bp-bullet';
    const out = [];
    for (const item of list.content || []) {
        (item.content || []).forEach((child, i) => {
            if (child.type === 'paragraph') {
                out.push(paragraph(child, ctx, i === 0
                    ? { numbering: { reference, level: Math.min(level, 4) } }
                    : { indent: { left: listIndent(level) } }));
            } else if (child.type === 'bulletList' || child.type === 'orderedList') {
                out.push(...listBlocks(child, ctx, level + 1));
            } else {
                out.push(...blocksToWord([child], ctx));
            }
        });
    }
    return out;
}

/** Column widths in twips for a table that must fit `total`. */
function columnWidths(rows, total) {
    const first = (rows[0]?.content || []);
    const spans = first.map((c) => c.attrs?.colspan || 1);
    const count = spans.reduce((a, b) => a + b, 0) || 1;
    const px = [];
    for (const c of first) {
        const w = c.attrs?.colwidth;
        for (let i = 0; i < (c.attrs?.colspan || 1); i++) px.push(Array.isArray(w) && w[i] ? w[i] : null);
    }
    if (px.length === count && px.every(Boolean)) {
        const sum = px.reduce((a, b) => a + b, 0);
        return px.map((w) => Math.max(1, Math.round((w / sum) * total)));
    }
    return Array.from({ length: count }, () => Math.floor(total / count));
}

function tableBlock(table, ctx) {
    const rows = table.content || [];
    const widths = columnWidths(rows, ctx.widthTwips);
    const total = widths.reduce((a, b) => a + b, 0);
    return [new Table({
        width: { size: total, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        borders: TABLE_BORDERS,
        rows: rows.map((row) => {
            const isHeader = (row.content || []).length > 0 && row.content.every((c) => c.type === 'tableHeader');
            let col = 0;
            return new TableRow({
                tableHeader: isHeader,
                cantSplit: true,
                children: (row.content || []).map((cell) => {
                    const span = cell.attrs?.colspan || 1;
                    const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0) || widths[0];
                    col += span;
                    const bold = cell.type === 'tableHeader';
                    return new TableCell({
                        width: { size: w, type: WidthType.DXA },
                        columnSpan: span > 1 ? span : undefined,
                        rowSpan: (cell.attrs?.rowspan || 1) > 1 ? cell.attrs.rowspan : undefined,
                        children: ensureChildren(blocksToWord(cell.content || [], { ...ctx, widthTwips: w }, { bold })),
                    });
                }),
            });
        }),
    })];
}

/** Word requires at least one paragraph in every cell. */
export function ensureChildren(children) {
    return children.length ? children : [new Paragraph({ spacing: SPACING })];
}

/**
 * @param {Array<object>} blocks doc JSON blocks (already continuation-merged)
 * @param {object} ctx
 * @param {{ bold?: boolean }} [base]
 * @returns {Array<Paragraph | Table>}
 */
export function blocksToWord(blocks, ctx, base = {}) {
    const out = [];
    for (const node of blocks || []) {
        switch (node.type) {
            case 'paragraph':
                out.push(paragraph(node, ctx, { base }));
                break;
            case 'bulletList':
            case 'orderedList':
                out.push(...listBlocks(node, ctx, 0));
                break;
            case 'image':
                out.push(...imageBlock(node, ctx));
                break;
            case 'table':
                out.push(...tableBlock(node, ctx));
                // Word fuses adjacent tables; a paragraph keeps them apart.
                out.push(new Paragraph({ spacing: { after: 0, line: 240 } }));
                break;
            default: {
                ctx.warn(`Unsupported block "${node.type}" exported as plain text.`);
                const text = plainText(node);
                out.push(new Paragraph({
                    spacing: SPACING,
                    children: inlineRuns([{ type: 'text', text }], ctx, base),
                }));
            }
        }
    }
    return out;
}
