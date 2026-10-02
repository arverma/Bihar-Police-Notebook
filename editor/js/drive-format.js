/**
 * Document `type` as written to Drive backup files.
 *
 * Earlier app versions accept any backup whose type is `letter` or `diary`
 * and read its content in their own format. A device still running one would
 * show a current document as blank — and if someone typed into it, sync that
 * back over the real document as the newer copy. So documents in the current
 * format are uploaded as `letter-doc` / `diary-doc`, a type those versions
 * skip, while backups in the earlier format (including their deletion
 * tombstones) keep the plain type so those devices still see them.
 */
import { parseDoc } from './editor/doc-format.js';

const CURRENT_SUFFIX = '-doc';

/**
 * @param {{ type: 'letter'|'diary', content?: string }} doc
 * @returns {string}
 */
export function remoteTypeFor(doc) {
    return parseDoc(doc.content) ? `${doc.type}${CURRENT_SUFFIX}` : doc.type;
}

/**
 * Local document type for a backup's type, or null for anything unknown.
 * @param {unknown} remoteType
 * @returns {'letter'|'diary'|null}
 */
export function localTypeFrom(remoteType) {
    const t = String(remoteType ?? '');
    const base = t.endsWith(CURRENT_SUFFIX) ? t.slice(0, -CURRENT_SUFFIX.length) : t;
    return base === 'letter' || base === 'diary' ? base : null;
}
