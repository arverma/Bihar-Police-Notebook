# Google Drive backup

Optional, **manual** sync. Nothing uploads until the user explicitly triggers a backup action.

- **Drive folder:** `Bihar Police Notebook Backup — do not delete` (in My Drive root)
- **Scope:** `https://www.googleapis.com/auth/drive.file` — can only see/create files that this app itself created; cannot read any other Drive content
- **File layout:** one JSON file per document named `{uuid}.json`, with `appProperties.uuid` set for reliable lookup

---

## Modules

| File | Role |
|------|------|
| [`drive-config.js`](../../editor/js/drive-config.js) | Client ID, Drive scope, folder name, API base URLs |
| [`drive-auth.js`](../../editor/js/drive-auth.js) | Google Identity Services token client; token cached in IndexedDB `bp-writing-tool-auth` for up to 24 h |
| [`drive-sync.js`](../../editor/js/drive-sync.js) | Push/pull logic, folder management, tombstone handling |
| [`document-store.js`](../../editor/js/document-store.js) | IndexedDB schema, sync-metadata fields, `needsBackup` predicate |

---

## IndexedDB schema — sync-related fields

Every document row (both `letter` and `diary` stores) carries these fields alongside content:

| Field | Type | Meaning |
|-------|------|---------|
| `uuid` | string | Stable identity across devices; never changes once assigned |
| `driveFileId` | string \| null | The Drive file `id` of the last successful upload; `null` = never uploaded |
| `syncedAt` | ISO string \| null | Timestamp of the last successful push to Drive |
| `syncError` | string \| null | Error message from the last failed push; cleared on next success |
| `deletedAt` | ISO string \| null | Set when the user deletes; `null` = live document (soft-delete, not immediate hard-delete) |

**`needsBackup(doc)` is true when any of the following hold:**

- `driveFileId` is null — never uploaded
- `syncedAt` is null — same as above
- `syncedAt < updated_at` — local content is newer than what was last pushed
- `deletedAt` is set and `syncedAt < deletedAt` — deletion tombstone not yet pushed

---

## Menu actions

| Action | What it does |
|--------|-------------|
| **Sync all** | `pullAndMerge()` then `pushPending()` — pulls remote changes first, then pushes every local doc that `needsBackup` |
| **Sync new** | `pushPending()` only — pushes dirty/new/deleted local docs without pulling |
| **Disconnect** | Revokes the GIS token in this browser and clears the `drive.connected` flag; does **not** delete the Drive folder or its files |

---

## Scenario reference — what happens in each case

### Document created locally (new save)

1. `saveDocumentById` adds a row with `driveFileId: null`, `syncedAt: null`, `deletedAt: null`.
2. `needsBackup` returns `true` (no `driveFileId`).
3. On next **Sync all** or **Sync new**: `pushPending` uploads the file to Drive, sets `driveFileId` and `syncedAt`.
4. IndexedDB row is now fully synced; badge shows "synced".

### Document edited locally

1. `saveDocumentById` updates `content`, `updated_at`; leaves `driveFileId` and `syncedAt` unchanged; clears `syncError`.
2. `needsBackup` returns `true` because `syncedAt < updated_at`.
3. On next push: `uploadDocFile` sends a `PATCH /upload` to the existing Drive file id.
4. `markSynced` updates `syncedAt` to now.

### Document deleted locally (user presses delete)

1. `softDeleteDocumentById` sets `deletedAt = now`, `updated_at = now`, clears `syncError`. The row stays in IndexedDB as a **tombstone** — invisible to normal document lists (`getDocuments` filters `deletedAt` rows out).
2. `needsBackup` returns `true` (syncedAt < deletedAt).
3. On next push: tombstone is uploaded to Drive with `deleted: true` in the JSON payload.
4. After successful upload, `hardDeleteById` removes the row from IndexedDB — the tombstone is purged locally.
5. On any other device: the next **Sync all** pull reads `deleted: true` from Drive and calls `upsertFromRemote` with `deletedAt` set → the document is soft-deleted locally (and hard-deleted after its own sync push).

### Document added from Drive (pull on another device / new device recovery)

1. `pullAndMerge` lists all JSON files in the backup folder.
2. For each file where `getDocumentByUuid` finds **no local match**: `upsertFromRemote` creates a new IndexedDB row with `syncedAt = updated_at` and `driveFileId` from Drive — already marked synced.
3. Document appears in history immediately after sync completes.

### Document updated on Drive (newer remote version)

1. `pullAndMerge` downloads the remote JSON and compares `remote.updated_at > local.updated_at`.
2. If remote is newer: `upsertFromRemote` overwrites local `content`, `filename`, `updated_at`, `syncedAt`. Local edits made since last sync are **overwritten** — last-write-wins by timestamp.
3. If local is newer or equal: remote is ignored. The next push will re-upload the local version.

### Document already exists locally but `driveFileId` is missing (e.g. after folder recovery)

1. On push: `pushPending` calls `findFileByUuid` to search Drive by `appProperties.uuid` before creating a new file.
2. If found: updates the existing Drive file (avoids duplicates).
3. If not found: creates a new file via multipart upload.

### Drive backup folder was deleted or lost

1. `ensureFolder` checks the cached folder id via a Drive `GET`. If the response is 404 or the folder is trashed, it clears the cached id and calls `clearAllDriveFileIds`.
2. `clearAllDriveFileIds` sets `driveFileId = null` on every local row (live + tombstones). `syncedAt` is preserved.
3. `ensureFolder` searches Drive for a folder with the expected name; creates it if not found.
4. Next push: all docs are treated as "never uploaded" and re-created in the new folder.

---

## Push flow (`pushPending`)

```
listPendingSync(type?)
  └─ for each doc where needsBackup:
       findFileByUuid(folderId, uuid)  ← search by appProperties if driveFileId missing
       uploadDocFile(doc, folderId, fileId)
         ├─ if fileId known → PATCH /upload (media only)
         ├─ if PATCH 404/403 → search by uuid again
         └─ if no file found → POST /upload multipart (creates new file)
       markSynced(type, id, { driveFileId, syncedAt })
       if doc.deletedAt → hardDeleteById(type, id)  ← purge tombstone
```

Operations are serialised through a single async queue (`enqueue`) — concurrent triggers do not race.

---

## Pull / merge flow (`pullAndMerge`)

```
ensureFolder()
driveList(folderId)          ← all .json files in the folder
  └─ for each remote file:
       downloadJson(fileId)
       getDocumentByUuid(uuid, type)
       ├─ no local match    → upsertFromRemote (creates row, marked synced)
       ├─ remote newer      → upsertFromRemote (overwrites local content)
       └─ local newer/equal → skip (optionally set driveFileId if missing)

getDocumentsIncludingDeleted()
  └─ hard-delete tombstones where syncedAt >= deletedAt (already pushed previously)
```

---

## Conflict resolution

There is **no three-way merge**. Resolution is last-write-wins by `updated_at` timestamp:

- Pull overwrites local if `remote.updated_at > local.updated_at`
- Push uploads local regardless of Drive state (Drive gets overwritten)
- Running **Sync all** (pull then push) on two devices simultaneously can lose one device's edits if timestamps are within the same second

---

## Auth — token lifecycle

- Connection state persisted in `localStorage` via `prefs.js` key `drive.connected`.
- Access token (short-lived, ~1 h Google limit) cached in IndexedDB `bp-writing-tool-auth` → `session` store.
- Session record retained for up to **24 hours** (`TOKEN_RETENTION_MS`). On next page load the token is hydrated silently if still valid.
- On 401 response: `driveFetch` invalidates the in-memory token, calls `ensureAccessToken({ allowInteractive: false })`, and retries once. If the silent refresh fails, the user must reconnect.

---

## Notes for maintainers

- OAuth Web client ID is in `drive-config.js`. Add authorized JavaScript origins for production and local preview. **Do not commit a client secret** — this is a public-client OAuth flow.
- `pageSize: 100` is used for Drive list calls. Projects with >100 documents paginate automatically via `nextPageToken`.
- Drive files use `appProperties.uuid` (not filename) as the stable identity key — safe to rename documents locally without breaking the Drive link.

See also: [Storage](storage.md), [Architecture](../architecture.md).
