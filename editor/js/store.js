/**
 * IndexedDB document store for letters and diaries.
 * Replaces the Flask/TinyDB backend.
 */

const DB_NAME = 'bp-writing-tool';
const DB_VERSION = 1;
const STORES = ['letter', 'diary'];

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('filename', 'filename', { unique: false });
                }
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
 * List all documents of a type (full content — IndexedDB is local).
 * @param {'letter'|'diary'} type
 * @returns {Promise<object[]>}
 */
export async function getDocuments(type) {
    const rows = await withStore(type, 'readonly', (s) => s.getAll());
    return (rows || []).map((doc) => ({
        ...doc,
        _id: String(doc.id),
        type,
    }));
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
 * Get letters and diaries combined.
 * @returns {Promise<object[]>}
 */
export async function getAllDocuments() {
    const [letters, diaries] = await Promise.all([
        getDocuments('letter'),
        getDocuments('diary'),
    ]);
    return [...letters, ...diaries];
}

/**
 * Save (upsert by id when present so rename does not duplicate).
 * @param {'letter'|'diary'} type
 * @param {{ id?: number|null, filename: string, content: string, created_at?: string }} doc
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
                    // Stale id — fall through to add
                    const created = doc.created_at || now;
                    const addReq = store.add({
                        filename,
                        content,
                        type,
                        created_at: created,
                        updated_at: now,
                    });
                    addReq.onsuccess = () => resolve(addReq.result);
                    addReq.onerror = () => reject(addReq.error);
                    return;
                }
                existing.filename = filename;
                existing.content = content;
                existing.updated_at = now;
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
            created_at: doc.created_at || now,
            updated_at: now,
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
 * Delete a document by filename.
 * @param {'letter'|'diary'} type
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
export async function deleteDocument(type, filename) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readwrite');
        const store = tx.objectStore(type);
        const idx = store.index('filename');
        const findReq = idx.getAll(filename);

        findReq.onsuccess = () => {
            const matches = findReq.result || [];
            if (matches.length === 0) {
                resolve(false);
                return;
            }
            const delReq = store.delete(matches[0].id);
            delReq.onsuccess = () => resolve(true);
            delReq.onerror = () => reject(delReq.error);
        };
        findReq.onerror = () => reject(findReq.error);
    });
}

/**
 * Load full document by filename (for opening from history).
 * @param {'letter'|'diary'} type
 * @param {string} filename
 * @returns {Promise<object|null>}
 */
export async function getDocumentByFilename(type, filename) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(type, 'readonly');
        const store = tx.objectStore(type);
        const idx = store.index('filename');
        const req = idx.get(filename);
        req.onsuccess = () => {
            const doc = req.result;
            if (!doc) {
                resolve(null);
                return;
            }
            resolve({ ...doc, _id: String(doc.id), type });
        };
        req.onerror = () => reject(req.error);
    });
}
