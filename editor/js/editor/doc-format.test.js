import { describe, expect, test } from 'vitest';
import { serializeDoc, parseDoc, isSupportedContent, docPlainText, docPages, VERSION } from './doc-format.js';
import { emptyDiaryJSON } from './schema.js';

describe('saved format', () => {
    test('round-trips a document', () => {
        const doc = emptyDiaryJSON();
        expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    });

    test.each([
        ['legacy diary JSON', JSON.stringify({ pages: [{ hasHeader: true, header: {}, left: 'a', right: '<p>b</p>' }] })],
        ['legacy flat diary JSON', JSON.stringify({ left_box: 'a', right_box: 'b' })],
        ['legacy letter HTML', '<p>पत्र</p><p><br></p>'],
        ['plain text', 'just some text'],
        ['a newer version', JSON.stringify({ format: 'bp-doc', v: VERSION + 1, doc: { type: 'doc', content: [] } })],
        ['malformed JSON', '{"format":"bp-doc",'],
        ['the right wrapper without a doc', JSON.stringify({ format: 'bp-doc', v: 1 })],
    ])('treats %s as unsupported', (_label, content) => {
        expect(isSupportedContent(content)).toBe(false);
        expect(parseDoc(content)).toBeNull();
    });

    test('empty content is a new document, not an unsupported one', () => {
        expect(isSupportedContent('')).toBe(true);
        expect(isSupportedContent(null)).toBe(true);
    });
});

describe('docPlainText', () => {
    test('a paragraph cut across pages reads as one paragraph', () => {
        const doc = {
            type: 'doc',
            content: [
                { type: 'letterPage', content: [{ type: 'flowCell', content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Hello wo' }] },
                ] }] },
                { type: 'letterPage', content: [{ type: 'flowCell', content: [
                    { type: 'paragraph', attrs: { cont: true }, content: [{ type: 'text', text: 'rld' }] },
                ] }] },
            ],
        };
        expect(docPlainText(doc)).toBe('one\nHello world');
    });
});

test('docPages lists header attributes per page', () => {
    const doc = emptyDiaryJSON();
    doc.content[0].attrs.fields.fir_number = '12/26';
    expect(docPages(doc)).toEqual([{ hasHeader: true, fields: expect.objectContaining({ fir_number: '12/26' }) }]);
});
