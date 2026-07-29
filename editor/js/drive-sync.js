/**
 * Incremental Google Drive backup / restore for IndexedDB documents.
 */

import {
    DRIVE_API_BASE,
    DRIVE_UPLOAD_BASE,
    DRIVE_FOLDER_NAME,
} from './drive-config.js';
import {
    authHeaders,
    ensureAccessToken,
    invalidateToken,
    isConnected,
} from './drive-auth.js';
import { getPref, setPref } from './prefs.js';
import {
    getDocumentById,
    getDocumentByUuid,
    getDocumentsIncludingDeleted,
    hardDeleteById,
    listPendingSync,
    markSynced,
    needsBackup,
    upsertFromRemote,
} from './store.js';

const FOLDER_ID_KEY = 'drive.folderId';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const JSON_MIME = 'application/json';

/** @type {Promise<void>} */
let queueTail = Promise.resolve();

/** @type {Set<() => void>} */
const statusListeners = new Set();

/** @type {'idle'|'syncing'|'error'} */
let syncState = 'idle';
/** @type {string|null} */
let lastSyncError = null;

/**
 * @param {() => void} fn
 * @returns {() => void}
 */
export function onSyncStatusChange(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

export function getSyncState() {
    return { state: syncState, error: lastSyncError };
}

function setSyncState(state, error = null) {
    syncState = state;
    lastSyncError = error;
    for (const fn of statusListeners) {
        try { fn(); } catch (_) { /* ignore */ }
    }
}

/**
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
function enqueue(fn) {
    const run = queueTail.then(fn, fn);
    queueTail = run.then(() => {}, () => {});
    return run;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {boolean} [retried]
 */
async function driveFetch(path, init = {}, retried = false) {
    const headers = {
        ...(init.headers || {}),
        ...(await authHeaders()),
    };
    const res = await fetch(path, { ...init, headers });
    if (res.status === 401 && !retried) {
        invalidateToken();
        await ensureAccessToken({ allowInteractive: false });
        return driveFetch(path, init, true);
    }
    return res;
}

/**
 * @param {string} q
 * @param {string} [fields]
 */
async function driveList(q, fields = 'files(id,name,appProperties,modifiedTime)') {
    const params = new URLSearchParams({
        q,
        spaces: 'drive',
        fields,
        pageSize: '100',
        corpora: 'user',
    });
    const files = [];
    let pageToken = '';
    do {
        if (pageToken) params.set('pageToken', pageToken);
        const res = await driveFetch(`${DRIVE_API_BASE}/files?${params}`);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Drive list failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        files.push(...(data.files || []));
        pageToken = data.nextPageToken || '';
    } while (pageToken);
    return files;
}

export async function ensureFolder() {
    const cached = getPref(FOLDER_ID_KEY, null);
    if (cached) {
        const res = await driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(String(cached))}?fields=id,trashed`,
        );
        if (res.ok) {
            const meta = await res.json();
            if (meta.id && !meta.trashed) return meta.id;
        }
        setPref(FOLDER_ID_KEY, null);
    }

    const safeName = DRIVE_FOLDER_NAME.replace(/'/g, "\\'");
    const existing = await driveList(
        `name='${safeName}' and mimeType='${FOLDER_MIME}' and trashed=false`,
        'files(id,name)',
    );
    if (existing[0]?.id) {
        setPref(FOLDER_ID_KEY, existing[0].id);
        return existing[0].id;
    }

    const res = await driveFetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: DRIVE_FOLDER_NAME,
            mimeType: FOLDER_MIME,
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Could not create Drive folder (${res.status}): ${text}`);
    }
    const created = await res.json();
    setPref(FOLDER_ID_KEY, created.id);
    return created.id;
}

/**
 * @param {object} doc
 */
function remotePayload(doc) {
    return {
        uuid: doc.uuid,
        type: doc.type,
        filename: doc.filename,
        content: doc.content ?? '',
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        deleted: Boolean(doc.deletedAt),
    };
}

/**
 * @param {string} folderId
 * @param {string} uuid
 */
async function findFileByUuid(folderId, uuid) {
    const safe = String(uuid).replace(/'/g, "\\'");
    const files = await driveList(
        `'${folderId}' in parents and trashed=false and appProperties has { key='uuid' and value='${safe}' }`,
        'files(id,name,appProperties)',
    );
    return files[0] || null;
}

/**
 * @param {object} doc
 * @param {string} folderId
 * @param {string|null} fileId
 */
async function uploadDocFile(doc, folderId, fileId) {
    const body = JSON.stringify(remotePayload(doc), null, 0);
    const metadata = {
        name: `${doc.uuid}.json`,
        mimeType: JSON_MIME,
        appProperties: {
            uuid: doc.uuid,
            type: doc.type,
        },
    };

    if (fileId) {
        const res = await driveFetch(
            `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': JSON_MIME },
                body,
            },
        );
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Drive update failed (${res.status}): ${text}`);
        }
        return fileId;
    }

    const boundary = `bpnt_${Date.now().toString(36)}`;
    const metaWithParent = { ...metadata, parents: [folderId] };
    const multipart =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metaWithParent)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${JSON_MIME}\r\n\r\n` +
        `${body}\r\n` +
        `--${boundary}--`;

    const res = await driveFetch(
        `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`,
        {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipart,
        },
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive create failed (${res.status}): ${text}`);
    }
    const created = await res.json();
    return created.id;
}

/**
 * Push one document (live or tombstone).
 * @param {'letter'|'diary'} type
 * @param {number} id
 */
export async function pushDocById(type, id) {
    return enqueue(async () => {
        if (!isConnected()) return { ok: false, reason: 'disconnected' };
        setSyncState('syncing');
        try {
            const doc = await getDocumentById(type, id);
            if (!doc || !doc.uuid) {
                setSyncState('idle');
                return { ok: false, reason: 'missing' };
            }
            if (!needsBackup(doc)) {
                setSyncState('idle');
                return { ok: true, skipped: true };
            }

            const folderId = await ensureFolder();
            let fileId = doc.driveFileId || null;
            if (!fileId) {
                const found = await findFileByUuid(folderId, doc.uuid);
                fileId = found?.id || null;
            }

            const newId = await uploadDocFile(doc, folderId, fileId);
            const syncedAt = new Date().toISOString();
            await markSynced(type, id, {
                driveFileId: newId,
                syncedAt,
                syncError: null,
            });

            if (doc.deletedAt) {
                await hardDeleteById(type, id);
            }

            setSyncState('idle');
            return { ok: true, driveFileId: newId };
        } catch (err) {
            const message = err?.message || String(err);
            try {
                await markSynced(type, id, { syncError: message });
            } catch (_) { /* ignore */ }
            setSyncState('error', message);
            return { ok: false, error: message };
        }
    });
}

/**
 * @param {object} doc
 */
export async function pushDoc(doc) {
    if (!doc?.id || !doc?.type) return { ok: false, reason: 'invalid' };
    return pushDocById(doc.type, doc.id);
}

export async function pushPending(type) {
    return enqueue(async () => {
        if (!isConnected()) return { ok: false, reason: 'disconnected' };
        setSyncState('syncing');
        try {
            const pending = await listPendingSync(type);
            const folderId = await ensureFolder();
            let okCount = 0;
            let lastError = null;
            for (const doc of pending) {
                try {
                    let fileId = doc.driveFileId || null;
                    if (!fileId) {
                        const found = await findFileByUuid(folderId, doc.uuid);
                        fileId = found?.id || null;
                    }
                    const newId = await uploadDocFile(doc, folderId, fileId);
                    const syncedAt = new Date().toISOString();
                    await markSynced(doc.type, doc.id, {
                        driveFileId: newId,
                        syncedAt,
                        syncError: null,
                    });
                    if (doc.deletedAt) {
                        await hardDeleteById(doc.type, doc.id);
                    }
                    okCount += 1;
                } catch (err) {
                    const message = err?.message || String(err);
                    lastError = message;
                    try {
                        await markSynced(doc.type, doc.id, { syncError: message });
                    } catch (_) { /* ignore */ }
                }
            }
            if (lastError && okCount === 0) {
                setSyncState('error', lastError);
                return { ok: false, error: lastError, count: 0 };
            }
            setSyncState(lastError ? 'error' : 'idle', lastError);
            return { ok: !lastError, count: okCount, error: lastError };
        } catch (err) {
            const message = err?.message || String(err);
            setSyncState('error', message);
            return { ok: false, error: message };
        }
    });
}

/**
 * @param {string} fileId
 */
async function downloadJson(fileId) {
    const res = await driveFetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive download failed (${res.status}): ${text}`);
    }
    return res.json();
}

export async function pullAndMerge() {
    return enqueue(async () => {
        if (!isConnected()) return { ok: false, reason: 'disconnected' };
        setSyncState('syncing');
        try {
            const folderId = await ensureFolder();
            const files = await driveList(
                `'${folderId}' in parents and trashed=false and mimeType='${JSON_MIME}'`,
                'files(id,name,appProperties,modifiedTime)',
            );

            let merged = 0;
            for (const file of files) {
                let remote;
                try {
                    remote = await downloadJson(file.id);
                } catch {
                    continue;
                }
                if (!remote?.uuid || (remote.type !== 'letter' && remote.type !== 'diary')) {
                    continue;
                }

                const local = await getDocumentByUuid(remote.uuid, remote.type);
                const remoteUpdated = remote.updated_at || file.modifiedTime || '';

                if (!local) {
                    await upsertFromRemote({
                        ...remote,
                        driveFileId: file.id,
                    });
                    merged += 1;
                    continue;
                }

                const localUpdated = local.updated_at || '';
                if (remoteUpdated > localUpdated) {
                    await upsertFromRemote({
                        ...remote,
                        driveFileId: file.id,
                    });
                    merged += 1;
                } else if (!local.driveFileId) {
                    await markSynced(local.type, local.id, {
                        driveFileId: file.id,
                        syncedAt: local.syncedAt || localUpdated,
                        syncError: null,
                    });
                }
            }

            // Purge local tombstones that finished syncing earlier is handled in push.
            // Soft-delete locals that are deleted remotely already applied via upsert.

            // Hard-delete local tombstones that are fully synced
            const all = await getDocumentsIncludingDeleted();
            for (const doc of all) {
                if (doc.deletedAt && doc.syncedAt && doc.syncedAt >= doc.deletedAt) {
                    await hardDeleteById(doc.type, doc.id);
                }
            }

            setSyncState('idle');
            return { ok: true, merged };
        } catch (err) {
            const message = err?.message || String(err);
            setSyncState('error', message);
            return { ok: false, error: message };
        }
    });
}

export async function syncAll() {
    const pull = await pullAndMerge();
    if (!pull.ok && pull.reason === 'disconnected') return pull;
    const push = await pushPending();
    return {
        ok: Boolean(pull.ok !== false && push.ok !== false),
        pull,
        push,
        error: push.error || pull.error || null,
    };
}

/**
 * @param {'letter'|'diary'} type
 * @param {number} id
 */
export async function backupOne(type, id) {
    return pushDocById(type, id);
}

/**
 * Backup all docs of the active template (letters or diaries).
 * @param {'letter'|'diary'} type
 */
export async function backupVisibleType(type) {
    return pushPending(type);
}
