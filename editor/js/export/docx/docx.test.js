import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildDocx } from './build.js';
import { mergeContinuations } from './merge-cont.js';
import { readImage } from './image-info.js';
import { BLOCK_TYPES } from './blocks.js';
import { PAGE_TYPES } from './pages.js';
import { INLINE_TYPES } from './inline.js';
import { letterDoc, diaryDoc, letterSchema, diarySchema } from '../../editor/test-helpers.js';

/** A PNG header carrying only a size: all the exporter reads. */
function pngDataUrl(width, height) {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, width);
    new DataView(b.buffer).setUint32(20, height);
    return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
}

async function parts(docNode) {
    const { blob, warnings } = await buildDocx(docNode.toJSON());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return {
        warnings,
        xml: await zip.file('word/document.xml').async('string'),
        numbering: await zip.file('word/numbering.xml').async('string'),
    };
}

const count = (s, re) => (s.match(re) || []).length;
const texts = (xml) => [...xml.matchAll(/<w:t[ >][^>]*>([^<]*)<\/w:t>|<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? m[2]);

describe('mergeContinuations', () => {
    const p = (text, cont) => ({ type: 'paragraph', attrs: { cont }, content: [{ type: 'text', text }] });

    it('joins a continuation to the paragraph before it, and only a continuation', () => {
        const out = mergeContinuations([p('one '), p('two', true), p('three')]);
        expect(out).toHaveLength(2);
        expect(out[0].content.map((n) => n.text).join('')).toBe('one two');
        expect(out[1].content[0].text).toBe('three');
    });

    it('joins list and table pieces of the same type', () => {
        const li = (t) => ({ type: 'listItem', content: [p(t)] });
        const list = (items, cont) => ({ type: 'orderedList', attrs: { start: 1, cont }, content: items.map(li) });
        const row = { type: 'tableRow', content: [] };
        const table = (rows, cont) => ({ type: 'table', attrs: { cont }, content: rows });
        expect(mergeContinuations([list(['a']), list(['b'], true)])[0].content).toHaveLength(2);
        expect(mergeContinuations([table([row]), table([row, row], true)])[0].content).toHaveLength(3);
    });

    it('never joins across different block types and does not mutate its input', () => {
        const input = [p('a'), { type: 'bulletList', attrs: { cont: true }, content: [] }];
        const snapshot = JSON.stringify(input);
        expect(mergeContinuations(input)).toHaveLength(2);
        expect(JSON.stringify(input)).toBe(snapshot);
    });
});

describe('letter export', () => {
    it('re-joins a paragraph the pager cut, with no forced page break', async () => {
        const { xml } = await parts(letterDoc([['first ', { t: 'second', cont: false }], [{ t: 'half and ', cont: true }]]));
        // page 2 begins with a continuation of the last block of page 1.
        expect(texts(xml).join('|')).toContain('second');
        expect(xml).not.toContain('w:type="page"');
        expect(xml).not.toContain('pageBreakBefore');
    });

    it('joins the cut paragraph into one Word paragraph', async () => {
        const { xml } = await parts(letterDoc([['alpha', { t: 'beta ' }], [{ t: 'gamma', cont: true }]]));
        expect(xml).toContain('beta ');
        // beta + gamma are runs of one paragraph: two paragraphs total, not three.
        expect(count(xml, /<w:p>|<w:p /g)).toBe(2);
    });

    it('sets A4 and the editor margins', async () => {
        const { xml } = await parts(letterDoc([['x']]));
        expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
        expect(xml).toMatch(/<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/);
    });

    it('gives Hindi runs the complex-script font and size, and carries bold to both property sets', async () => {
        const doc = letterSchema.nodeFromJSON({
            type: 'doc',
            content: [{ type: 'letterPage', content: [{ type: 'flowCell', attrs: { col: 'main' }, content: [{
                type: 'paragraph', content: [{ type: 'text', text: 'नमस्ते', marks: [{ type: 'bold' }] }],
            }] }] }],
        });
        const { xml } = await parts(doc);
        expect(xml).toContain('w:cs="Noto Sans Devanagari"');
        expect(xml).toContain('<w:b/>');
        expect(xml).toContain('<w:bCs/>');
        expect(xml).toContain('<w:szCs w:val="24"/>');
    });

    it('keeps an ordered list start and maps alignment', async () => {
        const { xml, numbering } = await parts(letterDoc([[{ ol: ['a', 'b'], start: 3 }, { t: 'right', align: 'right' }]]));
        expect(numbering).toMatch(/<w:start w:val="3"\/>/);
        expect(xml).toContain('<w:jc w:val="right"/>');
    });

    it('sizes an image to its saved percentage of the box, keeping the aspect ratio', async () => {
        const { xml, warnings } = await parts(letterDoc([[{ img: pngDataUrl(400, 200), width: 50 }]]));
        expect(warnings).toEqual([]);
        // box = (10466 - 216) twips / 15 = 683px; 50% -> 342px wide, 171px tall (EMU = px * 9525).
        expect(xml).toContain(`<wp:extent cx="${342 * 9525}" cy="${171 * 9525}"/>`);
    });

    it('turns a table into a Word table with a repeating header row', async () => {
        const { xml } = await parts(letterDoc([[{ table: [['H1', 'H2'], ['a', 'b']], header: true }]]));
        expect(count(xml, /<w:tr[ >]/g)).toBe(2);
        expect(xml).toContain('<w:tblHeader');
    });
});

describe('diary export', () => {
    const withFields = (node, fields) => {
        const json = node.toJSON();
        json.content[0].attrs.fields = { ...json.content[0].attrs.fields, ...fields };
        return diarySchema.nodeFromJSON(json);
    };

    it('writes the header block with its fields, the date as dd/mm/yyyy', async () => {
        const doc = withFields(diaryDoc([{ left: ['10 बजे'], right: ['जांच'] }]), {
            case_diary_no: '12', thana: 'कोतवाली', fir_date: '2024-03-05', investigation_record: '3',
        });
        const { xml } = await parts(doc);
        const all = texts(xml).join('|');
        expect(all).toContain('कोतवाली');
        expect(all).toContain('05/03/2024');
        expect(all).toContain('अन्वेषण का अभिलेख');
        expect(all).toContain('10 बजे');
        expect(all).toContain('जांच');
    });

    it('starts a new Word page at each later header page only', async () => {
        const doc = diaryDoc([
            { left: ['a'], right: ['b'], hasHeader: true },
            { left: ['c'], right: ['d'], hasHeader: false },
            { left: ['e'], right: ['f'], hasHeader: true },
        ]);
        const { xml } = await parts(doc);
        expect(count(xml, /<w:pageBreakBefore/g)).toBe(1);
    });

    it('gives each editor page one row of the body table', async () => {
        const one = await parts(diaryDoc([{ left: ['a'], right: ['b'] }]));
        const three = await parts(diaryDoc([{ left: ['a'], right: ['b'] }, { left: ['c'], right: ['d'] }, { left: ['e'], right: ['f'] }]));
        expect(count(three.xml, /<w:tr[ >]/g) - count(one.xml, /<w:tr[ >]/g)).toBe(2);
    });

    it('splits the body 20% / 80% of the content width', async () => {
        const { xml } = await parts(diaryDoc([{ left: ['a'], right: ['b'] }]));
        expect(xml).toContain('<w:gridCol w:w="2093"/><w:gridCol w:w="8373"/>');
    });

    it('never emits a cell without a paragraph (empty columns)', async () => {
        const { xml } = await parts(diaryDoc([{ left: [], right: [] }]));
        const cells = xml.match(/<w:tc>.*?<\/w:tc>/gs) || [];
        expect(cells.length).toBeGreaterThan(0);
        for (const tc of cells) expect(tc).toContain('<w:p>');
    });
});

describe('unmapped content', () => {
    it('degrades an unknown block to its text and warns instead of throwing', async () => {
        const json = letterDoc([['x']]).toJSON();
        json.content[0].content[0].content.push({ type: 'mystery', content: [{ type: 'text', text: 'kept' }] });
        const { blob, warnings } = await buildDocx(json);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        expect(await zip.file('word/document.xml').async('string')).toContain('kept');
        expect(warnings).toEqual(['Unsupported block "mystery" exported as plain text.']);
    });

    it('leaves an unreadable image out with a warning', async () => {
        const { warnings } = await parts(letterDoc([[{ img: 'data:image/png;base64,AAAA' }]]));
        expect(warnings).toHaveLength(1);
    });

    it('rejects a document it cannot recognise', async () => {
        await expect(buildDocx({ type: 'doc', content: [] })).rejects.toThrow(/unrecognised/);
    });

    it('maps every node type in both schemas explicitly', () => {
        const mapped = new Set([...PAGE_TYPES, ...BLOCK_TYPES, ...INLINE_TYPES]);
        const names = new Set([...Object.keys(letterSchema.nodes), ...Object.keys(diarySchema.nodes)]);
        expect([...names].filter((n) => !mapped.has(n))).toEqual([]);
    });
});

describe('readImage', () => {
    it('reads PNG size and rejects non-images', () => {
        expect(readImage(pngDataUrl(30, 20))).toMatchObject({ type: 'png', width: 30, height: 20 });
        expect(readImage('data:image/png;base64,AAAA')).toBeNull();
        expect(readImage('https://example.com/a.png')).toBeNull();
    });
});
