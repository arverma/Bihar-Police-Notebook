import { describe, expect, test } from 'vitest';
import { remoteTypeFor, localTypeFrom } from './drive-format.js';
import { serializeDoc } from './editor/doc-format.js';
import { emptyDiaryJSON, emptyLetterJSON } from './editor/schema.js';

/** The filter earlier app versions apply to every backup file they pull. */
const earlierVersionAccepts = (remote) => remote.type === 'letter' || remote.type === 'diary';

describe('backup type', () => {
    const current = { type: 'diary', content: serializeDoc(emptyDiaryJSON()) };
    const earlier = { type: 'diary', content: JSON.stringify({ pages: [{ left: 'a', right: '<p>b</p>' }] }) };

    test('current-format documents are invisible to earlier app versions', () => {
        expect(remoteTypeFor(current)).toBe('diary-doc');
        expect(remoteTypeFor({ type: 'letter', content: serializeDoc(emptyLetterJSON()) })).toBe('letter-doc');
        expect(earlierVersionAccepts({ type: remoteTypeFor(current) })).toBe(false);
    });

    test('earlier-format documents and their purged tombstones keep the plain type', () => {
        expect(remoteTypeFor(earlier)).toBe('diary');
        expect(remoteTypeFor({ type: 'diary', content: '' })).toBe('diary');
        expect(earlierVersionAccepts({ type: remoteTypeFor({ type: 'letter', content: '' }) })).toBe(true);
    });

    test('this version reads both', () => {
        expect(localTypeFrom('diary-doc')).toBe('diary');
        expect(localTypeFrom('letter-doc')).toBe('letter');
        expect(localTypeFrom('diary')).toBe('diary');
        expect(localTypeFrom('letter')).toBe('letter');
        expect(localTypeFrom('notes-doc')).toBeNull();
        expect(localTypeFrom(undefined)).toBeNull();
    });
});
