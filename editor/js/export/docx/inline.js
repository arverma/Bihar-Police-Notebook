/**
 * Inline content → Word runs.
 *
 * Bold/italic are set for both the Latin and complex-script (Devanagari)
 * properties: Word reads `b`/`i` for Latin text and `bCs`/`iCs` for Hindi,
 * so setting only one makes half the document ignore the mark.
 */
import { TextRun } from '../../../vendor/docx/docx.esm.js';
import { FONT, FONT_SIZE } from './constants.js';

/** Node types the inline mapper handles itself. */
export const INLINE_TYPES = ['text', 'hardBreak'];

/** Plain text of any node, used when a node has no faithful mapping. */
export function plainText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    return (node.content || []).map(plainText).join('');
}

function markNames(marks) {
    return new Set((marks || []).map((m) => m.type));
}

/**
 * @param {Array<object>} content inline nodes of a paragraph
 * @param {{ warn: (msg: string) => void }} ctx
 * @param {{ bold?: boolean }} [base] formatting that applies to every run (table header cells)
 * @returns {TextRun[]}
 */
export function inlineRuns(content, ctx, base = {}) {
    const runs = [];
    for (const node of content || []) {
        if (node.type === 'text') {
            if (!node.text) continue;
            const marks = markNames(node.marks);
            const bold = base.bold || marks.has('bold');
            const italics = marks.has('italic');
            runs.push(new TextRun({
                text: node.text,
                font: FONT,
                size: FONT_SIZE,
                sizeComplexScript: FONT_SIZE,
                bold,
                boldComplexScript: bold,
                italics,
                italicsComplexScript: italics,
                underline: marks.has('underline') ? {} : undefined,
            }));
        } else if (node.type === 'hardBreak') {
            runs.push(new TextRun({ break: 1 }));
        } else {
            ctx.warn(`Unsupported inline "${node.type}" exported as plain text.`);
            const text = plainText(node);
            if (text) runs.push(new TextRun({ text, font: FONT, size: FONT_SIZE, sizeComplexScript: FONT_SIZE }));
        }
    }
    return runs;
}
