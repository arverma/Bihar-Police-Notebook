/**
 * Which document the app opens on load.
 *
 *  1. The document that was open last, if it still exists and can be opened.
 *  2. Otherwise the top of History for that template — the newest document
 *     this version can open.
 *  3. A new document only when there is nothing to open.
 *
 * History lists documents in the same order (`newestFirst`), so "top of
 * History" here is always the row the user sees at the top.
 */

/** The date History groups and orders a document by. */
export function historyDate(doc) {
    return new Date(doc.created_at || doc.timestamp || doc.date || Date.now());
}

/** Documents in History order: newest created first. */
export function newestFirst(docs) {
    return [...docs].sort((a, b) => historyDate(b) - historyDate(a));
}

/**
 * @param {object} p
 * @param {'letter'|'diary'} p.lastType   template in use last time (default diary)
 * @param {object|null} p.lastDoc         the last opened document, if it was found
 * @param {object[]} p.historyDocs        live documents of `lastType`
 * @param {(doc: object) => boolean} p.canOpen
 * @returns {{ open: object } | { create: 'letter'|'diary' }}
 */
export function pickStartupDocument({ lastType, lastDoc, historyDocs, canOpen }) {
    if (lastDoc && !lastDoc.deletedAt && lastDoc.type === lastType && canOpen(lastDoc)) {
        return { open: lastDoc };
    }
    const top = newestFirst(historyDocs).find((d) => !d.deletedAt && canOpen(d));
    return top ? { open: top } : { create: lastType };
}
