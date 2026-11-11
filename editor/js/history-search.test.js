import { describe, expect, test } from 'vitest';
import { matchesQuery, searchableText } from './history-search.js';

const body = (text) => JSON.stringify({
    format: 'bp-doc', v: 1,
    doc: { type: 'doc', content: [{ type: 'page', attrs: { hasHeader: true, fields: { fir_number: '123/2026', case_diary_no: '7' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: text }] }] }] },
});

describe('history search', () => {
    test('matches filename, header fields and body text', () => {
        const hay = searchableText({ filename: 'Case notes', content: body('चोरी की घटना') });
        expect(matchesQuery(hay, 'case')).toBe(true);
        expect(matchesQuery(hay, '123/2026')).toBe(true);
        expect(matchesQuery(hay, 'चोरी')).toBe(true);
        expect(matchesQuery(hay, 'missing')).toBe(false);
    });

    test('every word must match, in any order, ignoring case and spacing', () => {
        const hay = searchableText({ filename: 'Diary', content: body('Arrested the Accused') });
        expect(matchesQuery(hay, '  ACCUSED   arrested ')).toBe(true);
        expect(matchesQuery(hay, 'accused released')).toBe(false);
    });

    test('an empty query matches everything', () => {
        expect(matchesQuery(searchableText({ filename: 'x', content: '' }), '   ')).toBe(true);
    });

    test('content this version cannot open is searchable by filename only', () => {
        const hay = searchableText({ filename: 'Old file', content: '<p>legacy</p>' });
        expect(matchesQuery(hay, 'old')).toBe(true);
        expect(matchesQuery(hay, 'legacy')).toBe(false);
    });
});
