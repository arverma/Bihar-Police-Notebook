/**
 * Builders for unit tests: real schemas, small documents, states.
 * (Test-only module; not imported by the app.)
 */
import { getSchema, EditorState, TextSelection } from './tiptap.js';
import { letterExtensions, diaryExtensions } from './schema.js';
import { emptyHeader } from './diary-geometry.js';
import { blockJSON, tableText } from './block-spec.js';

export { blockJSON, tableText };

export const letterSchema = getSchema(letterExtensions());
export const diarySchema = getSchema(diaryExtensions());

function cellJSON(col, blocks) {
    return { type: 'flowCell', attrs: { col }, content: (blocks.length ? blocks : ['']).map(blockJSON) };
}

/** @param {Array<Array<any>>} pages blocks per page */
export function letterDoc(pages) {
    return letterSchema.nodeFromJSON({
        type: 'doc',
        content: pages.map((blocks) => ({ type: 'letterPage', content: [cellJSON('main', blocks)] })),
    });
}

/** @param {Array<{ left?: any[], right?: any[], hasHeader?: boolean }>} pages */
export function diaryDoc(pages) {
    return diarySchema.nodeFromJSON({
        type: 'doc',
        content: pages.map((p, i) => ({
            type: 'diaryPage',
            attrs: { hasHeader: p.hasHeader ?? i === 0, fields: emptyHeader() },
            content: [cellJSON('left', p.left || []), cellJSON('right', p.right || [])],
        })),
    });
}

export function stateFor(doc, selection) {
    const state = EditorState.create({ doc });
    if (selection == null) return state;
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, selection)));
}

/** Position just inside the text of the paragraph containing `text`, at `offset`. */
export function posOf(doc, text, offset = 0) {
    let found = -1;
    doc.descendants((node, pos) => {
        if (found >= 0) return false;
        if (node.isTextblock && node.textContent.includes(text)) {
            found = pos + 1 + node.textContent.indexOf(text) + offset;
            return false;
        }
        return true;
    });
    if (found < 0) throw new Error(`text not found: ${text}`);
    return found;
}

/** Column text per page: [['a','+b'], ...] where '+' marks a continuation. */
export function columnPages(doc, col) {
    const out = [];
    doc.forEach((page) => {
        const blocks = [];
        page.forEach((cell) => {
            if (cell.attrs.col !== col) return;
            cell.forEach((b) => {
                const prefix = b.attrs.cont ? '+' : '';
                if (b.type.name === 'orderedList') blocks.push(`${prefix}ol(${b.attrs.start}):${b.textContent}`);
                else if (b.type.name === 'table') blocks.push(`${prefix}table:${tableText(b)}`);
                else if (b.type.name === 'image') blocks.push(`${prefix}img`);
                else blocks.push(prefix + b.textContent);
            });
        });
        out.push(blocks);
    });
    return out;
}
