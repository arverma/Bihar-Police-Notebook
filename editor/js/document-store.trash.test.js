import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
    DocumentUnavailableError,
    deleteTrashedForever,
    getDocumentById,
    getDocuments,
    getTrashedDocuments,
    listPendingSync,
    markSynced,
    needsBackup,
    restoreDocumentById,
    saveDocumentById,
    trashDocumentById,
    upsertFromRemote,
} from './document-store.js';

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
});

async function seed(extra = {}) {
    const id = await saveDocumentById('diary', { filename: 'one', content: 'v1' });
    if (extra.synced) {
        const { updated_at } = await getDocumentById('diary', id);
        await markSynced('diary', id, { driveFileId: 'drive-1', syncedAt: updated_at });
    }
    return id;
}

describe('Trash', () => {
    test('trashed docs leave History, keep content, and show in Trash', async () => {
        const id = await seed();
        await trashDocumentById('diary', id);
        expect(await getDocuments('diary')).toEqual([]);
        const [trashed] = await getTrashedDocuments('diary');
        expect(trashed.id).toBe(id);
        expect(trashed.content).toBe('v1');
    });

    test('a late autosave cannot pull a trashed doc out of Trash', async () => {
        const id = await seed();
        await trashDocumentById('diary', id);
        await expect(saveDocumentById('diary', { id, filename: 'one', content: 'late' }))
            .rejects.toBeInstanceOf(DocumentUnavailableError);
        expect(await getDocuments('diary')).toEqual([]);
        expect((await getDocumentById('diary', id)).content).toBe('v1');
    });

    test('trashing leaves updated_at alone and never queues an upload', async () => {
        const id = await seed({ synced: true });
        const before = await getDocumentById('diary', id);
        await trashDocumentById('diary', id);
        const after = await getDocumentById('diary', id);
        expect(after.updated_at).toBe(before.updated_at);
        expect(needsBackup(after)).toBe(false);
        expect(await listPendingSync('diary')).toEqual([]);
    });

    test('a never-backed-up trashed doc is not queued for upload either', async () => {
        const id = await seed();
        expect((await listPendingSync('diary')).length).toBe(1);
        await trashDocumentById('diary', id);
        expect(await listPendingSync('diary')).toEqual([]);
    });

    test('restore brings the doc back and queues it for backup', async () => {
        const id = await seed({ synced: true });
        await trashDocumentById('diary', id);
        await new Promise((r) => setTimeout(r, 5));
        await restoreDocumentById('diary', id);
        expect((await getDocuments('diary')).map((d) => d.id)).toEqual([id]);
        expect((await listPendingSync('diary')).map((d) => d.id)).toEqual([id]);
        expect(await restoreDocumentById('diary', id)).toBeNull();
    });

    test('a remote edit refreshes a trashed doc but keeps it in Trash', async () => {
        const id = await seed({ synced: true });
        const { uuid } = await getDocumentById('diary', id);
        await trashDocumentById('diary', id);
        await upsertFromRemote({ uuid, type: 'diary', filename: 'one', content: 'remote', updated_at: '2999-01-01T00:00:00.000Z', driveFileId: 'drive-1' });
        expect(await getDocuments('diary')).toEqual([]);
        const [trashed] = await getTrashedDocuments('diary');
        expect(trashed.content).toBe('remote');
        expect(needsBackup(trashed)).toBe(false);
    });

    test('a remote tombstone removes the doc from Trash for good', async () => {
        const id = await seed({ synced: true });
        const { uuid } = await getDocumentById('diary', id);
        await trashDocumentById('diary', id);
        await upsertFromRemote({ uuid, type: 'diary', filename: 'one', content: '', deleted: true, updated_at: '2999-01-01T00:00:00.000Z' });
        expect(await getTrashedDocuments('diary')).toEqual([]);
        const row = await getDocumentById('diary', id);
        expect(row.deletedAt).toBeTruthy();
        expect(row.trashedAt).toBeNull();
    });

    test('delete forever: never-backed-up doc is removed outright when disconnected', async () => {
        const id = await seed();
        await trashDocumentById('diary', id);
        await deleteTrashedForever('diary', id, { connected: false });
        expect(await getDocumentById('diary', id)).toBeNull();
    });

    test('delete forever: a doc with a Drive copy becomes an uploadable tombstone', async () => {
        const id = await seed({ synced: true });
        await trashDocumentById('diary', id);
        await new Promise((r) => setTimeout(r, 5));
        await deleteTrashedForever('diary', id, { connected: false });
        expect(await getTrashedDocuments('diary')).toEqual([]);
        const [pending] = await listPendingSync('diary');
        expect(pending.id).toBe(id);
        expect(pending.deletedAt).toBeTruthy();
    });

    test('delete forever only acts on trashed docs', async () => {
        const id = await seed();
        expect(await deleteTrashedForever('diary', id, { connected: false })).toBeNull();
        expect((await getDocuments('diary')).length).toBe(1);
    });
});
