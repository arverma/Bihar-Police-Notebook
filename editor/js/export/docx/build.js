/**
 * Export a document to Word.
 *
 *   const { blob, warnings } = await buildDocx(docJSON);
 *
 * `docJSON` is the editor's `getJSON()` (a letter or a diary). The mapping is
 * a pure function of that JSON — no DOM — so it is unit-tested directly. The
 * router loads this module (and with it the ~400 KB `docx` bundle) only on
 * the first Word export.
 *
 * Content that has no faithful Word form degrades to plain text and is
 * listed in `warnings`; a valid document never makes the export throw.
 */
import { Document, Packer, LevelFormat, AlignmentType } from '../../../vendor/docx/docx.esm.js';
import { letterBody, diaryBody } from './pages.js';
import { PAGE, FONT, FONT_SIZE } from './constants.js';

export { mergeContinuations } from './merge-cont.js';

/** Numbering definition for one list: bullets, or decimals starting at `start`. */
function numberingConfig(reference, ordered, start) {
    const bullets = ['•', '◦', '▪'];
    return {
        reference,
        levels: Array.from({ length: 5 }, (_, level) => ({
            level,
            format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: ordered ? `%${level + 1}.` : bullets[level % bullets.length],
            alignment: AlignmentType.LEFT,
            start: ordered && level === 0 ? start : 1,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
    };
}

/**
 * @param {object} docJSON editor document JSON (`{ type: 'doc', content: [...] }`)
 * @returns {Promise<{ blob: Blob, warnings: string[] }>}
 */
export async function buildDocx(docJSON) {
    const warnings = [];
    const numbering = [numberingConfig('bp-bullet', false, 1)];
    const ctx = {
        warn: (msg) => { if (!warnings.includes(msg)) warnings.push(msg); },
        ordered: (start) => {
            const reference = `bp-ordered-${numbering.length}`;
            numbering.push(numberingConfig(reference, true, start));
            return reference;
        },
    };

    const kind = docJSON?.content?.[0]?.type;
    if (kind !== 'letterPage' && kind !== 'diaryPage') throw new Error('Nothing to export: unrecognised document.');
    const children = kind === 'diaryPage' ? diaryBody(docJSON, ctx) : letterBody(docJSON, ctx);

    const doc = new Document({
        creator: 'Bihar Police Notebook',
        styles: { default: { document: { run: { font: FONT, size: FONT_SIZE, sizeComplexScript: FONT_SIZE } } } },
        numbering: { config: numbering },
        sections: [{
            properties: {
                page: {
                    size: { width: PAGE.width, height: PAGE.height },
                    margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
                },
            },
            children,
        }],
    });
    return { blob: await Packer.toBlob(doc), warnings };
}
