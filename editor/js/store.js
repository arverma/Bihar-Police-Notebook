/**
 * IndexedDB document store for letters and diaries.
 * Optional Google Drive sync metadata lives on each row.
 */

const DB_NAME = 'bp-writing-tool';
const DB_VERSION = 2;
const STORES = ['letter', 'diary'];

function newUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {IDBDatabase} db
 * @param {IDBTransaction} [tx]
 */
function migrateAssignUuids(db, tx) {
    const txn = tx || db.transaction(STORES, 'readwrite');
    for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) continue;
        const store = txn.objectStore(name);
        const req = store.openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            const row = cursor.value;
            if (!row.uuid) {
                row.uuid = newUuid();
                cursor.update(row);
            }
            cursor.continue();
        };
    }
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = req.result;
            const oldVersion = event.oldVersion || 0;
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('filename', 'filename', { unique: false });
                    store.createIndex('uuid', 'uuid', { unique: true });
                } else if (oldVersion < 2) {
                    const store = req.transaction.objectStore(name);
                    if (!store.indexNames.contains('uuid')) {
                        store.createIndex('uuid', 'uuid', { unique: false });
                    }
                }
            }
            if (oldVersion < 2) {
                migrateAssignUuids(db, req.transaction);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 */
async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} doc
 * @param {'letter'|'diary'} type
 */
function normalizeDoc(doc, type) {
    return {
        ...doc,
        _id: String(doc.id),
        type,
    };
}

/**
 * List live (non-deleted) documents of a type.
 * @param {'letter'|'diary'} type
 * @returns {Promise<object[]>}
 */
export async function getDocuments(type) {
    const rows = await withStore(type, 'readonly', (s) => s.getAll());
    return (rows || [])
        .filter((doc) => !doc.deletedAt)
        .map((doc) => normalizeDoc(doc, type));
}

/**
 * List all rows including soft-deleted (for sync).
 * @param {'letter'|'diary'} [type]
 * @returns {Promise<object[]>}
 */
export async function getDocumentsIncludingDeleted(type) {
    if (type) {
        const rows = await withStore(type, 'readonly', (s) => s.getAll());
        return (rows || []).map((doc) => normalizeDoc(doc, type));
    }
    const [letters, diaries] = await Promise.all([
        getDocumentsIncludingDeleted('letter'),
        getDocumentsIncludingDeleted('diary'),
    ]);
    return [...letters, ...diaries];
}

/**
 * Short plain-text preview for the history sidebar.
 * @param {object} doc
 * @returns {string}
 */
export function previewText(doc) {
    if (doc.type === 'diary') {
        let data = doc.content;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (_) { data = {}; }
        }
        if (data && typeof data === 'object') {
            const header = data.header && typeof data.header === 'object' ? data.header : data;
            return `FIR ${header.fir_number || ''} · Case ${header.case_diary_no || ''}`.trim();
        }
    }
    return stripHtml(doc.content).slice(0, 40);
}

/**
 * Whether a doc needs a Drive upload.
 * @param {object} doc
 * @returns {boolean}
 */
export function needsBackup(doc) {
    if (doc.deletedAt) {
        return !doc.syncedAt || doc.syncedAt < doc.deletedAt || doc.syncedAt < doc.updated_at;
    }
    if (!doc.driveFileId || !doc.syncedAt) return true;
    return doc.syncedAt < (doc.updated_at || '');
}

/**
 * @param {object} doc
 * @returns {'synced'|'pending'|'error'}
 */
export function backupStatus(doc) {
    if (doc.syncError && needsBackup(doc)) return 'error';
    if (needsBackup(doc)) return 'pending';
    return 'synced';
}

/**
 * Save (upsert by id when present so rename does not duplicate).
 * @param {'letter'|'diary'} type
 * @param {{ id?: number|null, filename: string, content: string, created_at?: string, uuid?: string }} doc
 * @returns {Promise<number>} document id
 */
export async function saveDocumentById(type, doc) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const now = new Date().toISOString();
        const filename = (doc.filename || '').trim() || 'Untitled';
        const content = doc.content ?? '';

        if (doc.id != null) {
            const getReq = store.get(doc.id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) {
                    const created = doc.created_at || now;
                    const addReq = store.add({
                        filename,
                        content,
                        type,
                        uuid: doc.uuid || newUuid(),
                        created_at: created,
                        updated_at: now,
                        driveFileId: null,
                        syncedAt: null,
                        syncError: null,
                        deletedAt: null,
                    });
                    addReq.onsuccess = () => resolve(addReq.result);
                    addReq.onerror = () => reject(addReq.error);
                    return;
                }
                existing.filename = filename;
                existing.content = content;
                existing.updated_at = now;
                existing.deletedAt = null;
                if (!existing.uuid) existing.uuid = doc.uuid || newUuid();
                // Content change invalidates sync until next push
                existing.syncError = null;
                const putReq = store.put(existing);
                putReq.onsuccess = () => resolve(existing.id);
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
            return;
        }

        const addReq = store.add({
            filename,
            content,
            type,
            uuid: doc.uuid || newUuid(),
            created_at: doc.created_at || now,
            updated_at: now,
            driveFileId: null,
            syncedAt: null,
            syncError: null,
            deletedAt: null,
        });
        addReq.onsuccess = () => resolve(addReq.result);
        addReq.onerror = () => reject(addReq.error);
    });
}

/**
 * Save (upsert by filename) a document.
 * @param {'letter'|'diary'} type
 * @param {string} filename
 * @param {string} content
 */
export async function saveDocument(type, filename, content) {
    return saveDocumentById(type, { id: null, filename, content });
}

/**
 * Soft-delete a document by id (for Drive tombstone sync).
 * @param {'letter'|'diary'} type
 * @param {number} id
 * @returns {Promise<object|null>} deleted row or null
 */
export async function softDeleteDocumentById(type, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const findReq = store.get(id);

        findReq.onsuccess = () => {
            const row = findReq.result;
            if (!row || row.deletedAt) {
                resolve(null);
                return;
            }
            const now = new Date().toISOString();
            row.deletedAt = now;
            row.updated_at = now;
            row.syncError = null;
            const putReq = store.put(row);
            putReq.onsuccess = () => resolve({ ...row, type, _id: String(row.id) });
            putReq.onerror = () => reject(putReq.error);
        };
        findReq.onerror = () => reject(findReq.error);
    });
}

/**
 * Soft-delete a document by filename (for Drive tombstone sync).
 * @param {'letter'|'diary'} type
 * @param {string} filename
 * @returns {Promise<object|null>} deleted row or null
 */
export async function softDeleteDocument(type, filename) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const idx = store.index('filename');
        const findReq = idx.getAll(filename);

        findReq.onsuccess = () => {
            const matches = (findReq.result || []).filter((d) => !d.deletedAt);
            if (matches.length === 0) {
                resolve(null);
                return;
            }
            const row = matches[0];
            const now = new Date().toISOString();
            row.deletedAt = now;
            row.updated_at = now;
            row.syncError = null;
            const putReq = store.put(row);
            putReq.onsuccess = () => resolve({ ...row, type, _id: String(row.id) });
            putReq.onerror = () => reject(putReq.error);
        };
        findReq.onerror = () => reject(findReq.error);
    });
}

/**
 * Hard-delete a row by id (after tombstone synced, or legacy).
 * @param {'letter'|'diary'} type
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function hardDeleteById(type, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Clear Drive file ids on all docs (live + tombstones) after the backup folder is lost.
 * Keeps syncedAt / content so the next push re-creates remotes via needsBackup (!driveFileId).
 * @returns {Promise<number>} number of rows updated
 */
export async function clearAllDriveFileIds() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, 'readwrite');
        let updated = 0;
        let pending = STORES.length;
        let failed = false;

        for (const name of STORES) {
            if (!db.objectStoreNames.contains(name)) {
                pending -= 1;
                if (pending === 0 && !failed) resolve(updated);
                continue;
            }
            const store = tx.objectStore(name);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                    pending -= 1;
                    if (pending === 0 && !failed) resolve(updated);
                    return;
                }
                const row = cursor.value;
                if (row.driveFileId != null) {
                    row.driveFileId = null;
                    cursor.update(row);
                    updated += 1;
                }
                cursor.continue();
            };
            req.onerror = () => {
                failed = true;
                reject(req.error);
            };
        }

        tx.onerror = () => {
            failed = true;
            reject(tx.error);
        };
    });
}

/**
 * @param {'letter'|'diary'} type
 * @param {number} id
 * @param {{ driveFileId?: string|null, syncedAt?: string|null, syncError?: string|null, deletedAt?: string|null }} fields
 */
export async function markSynced(type, id, fields) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const row = getReq.result;
            if (!row) {
                resolve(false);
                return;
            }
            if ('driveFileId' in fields) row.driveFileId = fields.driveFileId;
            if ('syncedAt' in fields) row.syncedAt = fields.syncedAt;
            if ('syncError' in fields) row.syncError = fields.syncError;
            if ('deletedAt' in fields) row.deletedAt = fields.deletedAt;
            const putReq = store.put(row);
            putReq.onsuccess = () => resolve(true);
            putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

/**
 * Docs that need uploading (including tombstones).
 * @param {'letter'|'diary'} [type]
 * @returns {Promise<object[]>}
 */
export async function listPendingSync(type) {
    const docs = type
        ? await getDocumentsIncludingDeleted(type)
        : await getDocumentsIncludingDeleted();
    return docs.filter(needsBackup);
}

/**
 * Find by uuid across stores or one store.
 * @param {string} uuid
 * @param {'letter'|'diary'} [type]
 * @returns {Promise<object|null>}
 */
export async function getDocumentByUuid(uuid, type) {
    const types = type ? [type] : STORES;
    for (const t of types) {
        const db = await openDb();
        const found = await new Promise((resolve, reject) => {
            const tx = db.transaction(t, 'readonly');
            const store = tx.objectStore(t);
            if (!store.indexNames.contains('uuid')) {
                const allReq = store.getAll();
                allReq.onsuccess = () => {
                    const hit = (allReq.result || []).find((d) => d.uuid === uuid);
                    resolve(hit ? normalizeDoc(hit, t) : null);
                };
                allReq.onerror = () => reject(allReq.error);
                return;
            }
            const idx = store.index('uuid');
            const req = idx.get(uuid);
            req.onsuccess = () => {
                const doc = req.result;
                resolve(doc ? normalizeDoc(doc, t) : null);
            };
            req.onerror = () => reject(req.error);
        });
        if (found) return found;
    }
    return null;
}

/**
 * Upsert from a remote Drive payload (by uuid).
 * @param {{
 *   uuid: string,
 *   type: 'letter'|'diary',
 *   filename: string,
 *   content: string,
 *   created_at?: string,
 *   updated_at?: string,
 *   deleted?: boolean,
 *   driveFileId?: string|null,
 * }} remote
 * @returns {Promise<object>}
 */
export async function upsertFromRemote(remote) {
    const type = remote.type === 'letter' ? 'letter' : 'diary';
    const existing = await getDocumentByUuid(remote.uuid, type);
    const now = new Date().toISOString();
    const updatedAt = remote.updated_at || now;
    const createdAt = remote.created_at || updatedAt;
    const deletedAt = remote.deleted ? (remote.updated_at || now) : null;

    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);

        if (existing) {
            const getReq = store.get(existing.id);
            getReq.onsuccess = () => {
                const row = getReq.result;
                if (!row) {
                    reject(new Error('Missing row during upsert'));
                    return;
                }
                row.filename = remote.filename || row.filename;
                row.content = remote.content ?? row.content;
                row.updated_at = updatedAt;
                row.created_at = row.created_at || createdAt;
                row.uuid = remote.uuid;
                row.deletedAt = deletedAt;
                if (remote.driveFileId) row.driveFileId = remote.driveFileId;
                row.syncedAt = updatedAt;
                row.syncError = null;
                const putReq = store.put(row);
                putReq.onsuccess = () => resolve(normalizeDoc(row, type));
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
            return;
        }

        const addReq = store.add({
            filename: remote.filename || 'Untitled',
            content: remote.content ?? '',
            type,
            uuid: remote.uuid,
            created_at: createdAt,
            updated_at: updatedAt,
            driveFileId: remote.driveFileId || null,
            syncedAt: updatedAt,
            syncError: null,
            deletedAt,
        });
        addReq.onsuccess = () => {
            resolve(normalizeDoc({
                id: addReq.result,
                filename: remote.filename || 'Untitled',
                content: remote.content ?? '',
                type,
                uuid: remote.uuid,
                created_at: createdAt,
                updated_at: updatedAt,
                driveFileId: remote.driveFileId || null,
                syncedAt: updatedAt,
                syncError: null,
                deletedAt,
            }, type));
        };
        addReq.onerror = () => reject(addReq.error);
    });
}

/**
 * @param {'letter'|'diary'} type
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getDocumentById(type, id) {
    const row = await withStore(type, 'readonly', (s) => s.get(id));
    return row ? normalizeDoc(row, type) : null;
}
