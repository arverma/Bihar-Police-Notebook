import { describe, expect, test } from 'vitest';
import { pickStartupDocument, newestFirst } from './startup-document.js';

const doc = (id, created, extra = {}) => ({ id, type: 'diary', created_at: created, content: '', ...extra });
const canOpen = (d) => !d.unopenable;

describe('pickStartupDocument', () => {
    const history = [doc(1, '2026-09-01T10:00:00Z'), doc(2, '2026-10-01T10:00:00Z'), doc(3, '2026-09-15T10:00:00Z')];

    test('reopens the document that was open last', () => {
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: history[0], historyDocs: history, canOpen }))
            .toEqual({ open: history[0] });
    });

    test('without a last document, opens the top of History (newest created)', () => {
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: null, historyDocs: history, canOpen }))
            .toEqual({ open: history[1] });
    });

    test('a deleted or unopenable last document falls back to the top of History', () => {
        const deleted = doc(9, '2026-10-02T10:00:00Z', { deletedAt: '2026-10-02T11:00:00Z' });
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: deleted, historyDocs: history, canOpen }).open.id).toBe(2);
        const old = doc(8, '2026-10-02T10:00:00Z', { unopenable: true });
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: old, historyDocs: [old, ...history], canOpen }).open.id).toBe(2);
    });

    test('skips documents this version cannot open', () => {
        const newestOld = doc(7, '2026-12-01T10:00:00Z', { unopenable: true });
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: null, historyDocs: [newestOld, ...history], canOpen }).open.id).toBe(2);
    });

    test('creates a new document only when History has nothing to open', () => {
        expect(pickStartupDocument({ lastType: 'letter', lastDoc: null, historyDocs: [], canOpen })).toEqual({ create: 'letter' });
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: null, historyDocs: [doc(1, '2026-01-01', { unopenable: true })], canOpen }))
            .toEqual({ create: 'diary' });
    });

    test('a last document of the other template is not reopened under this one', () => {
        const letter = { ...doc(5, '2026-10-05T10:00:00Z'), type: 'letter' };
        expect(pickStartupDocument({ lastType: 'diary', lastDoc: letter, historyDocs: history, canOpen }).open.id).toBe(2);
    });
});

test('newestFirst orders like History', () => {
    expect(newestFirst([doc(1, '2026-01-01'), doc(2, '2026-03-01'), doc(3, '2026-02-01')]).map((d) => d.id)).toEqual([2, 3, 1]);
});
