/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from 'vitest';
import { createDocSheet } from './doc-sheet.js';
import { serializeDoc } from './doc-format.js';
import { emptyLetterJSON, emptyDiaryJSON } from './schema.js';

let sheet;
afterEach(() => sheet?.destroy());

function letterSheet() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sheet = createDocSheet(host, 'letter', {});
    return sheet;
}

test('opens its own saved documents and new (empty) ones', () => {
    const s = letterSheet();
    expect(s.canOpen(serializeDoc(emptyLetterJSON()))).toBe(true);
    expect(s.canOpen('')).toBe(true);
});

test('refuses the other template\'s document and damaged content', () => {
    const s = letterSheet();
    expect(s.canOpen(serializeDoc(emptyDiaryJSON()))).toBe(false);
    const damaged = emptyLetterJSON();
    damaged.content[0].content = []; // a page must hold a cell
    expect(s.canOpen(serializeDoc(damaged))).toBe(false);
    expect(s.canOpen(JSON.stringify({ format: 'bp-doc', v: 1, doc: { type: 'doc', content: [{ type: 'nope' }] } }))).toBe(false);
});

test('loading unopenable content falls back to an empty document instead of throwing', () => {
    const s = letterSheet();
    expect(() => s.setContent(serializeDoc(emptyDiaryJSON()))).not.toThrow();
    expect(s.getPlainText()).toBe('');
    expect(s.pageCount).toBe(1);
});

test('round-trips its content', () => {
    const s = letterSheet();
    const json = emptyLetterJSON();
    json.content[0].content[0].content = [{ type: 'paragraph', content: [{ type: 'text', text: 'पत्र' }] }];
    s.setContent(serializeDoc(json));
    expect(JSON.parse(s.getContent()).doc).toMatchObject(json);
});

test('a document holding only an image or an empty table counts as content (it is saved)', () => {
    const s = letterSheet();
    expect(s.hasMeaningfulContent()).toBe(false);
    const withImage = emptyLetterJSON();
    withImage.content[0].content[0].content = [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }];
    s.setContent(serializeDoc(withImage));
    expect(s.getPlainText()).toBe('');
    expect(s.hasMeaningfulContent()).toBe(true);

    const withTable = emptyLetterJSON();
    withTable.content[0].content[0].content = [{
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }],
    }];
    s.setContent(serializeDoc(withTable));
    expect(s.hasMeaningfulContent()).toBe(true);
});
