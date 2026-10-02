/**
 * Saved document format.
 *
 *   { "format": "bp-doc", "v": 1, "doc": <ProseMirror doc JSON> }
 *
 * The wrapper lets the app recognise content it cannot open (anything else,
 * or a newer version) instead of mounting it, and lets a later schema
 * version migrate older documents in one place.
 */

export const FORMAT = 'bp-doc';
export const VERSION = 1;

/** @param {object} docJSON */
export function serializeDoc(docJSON) {
    return JSON.stringify({ format: FORMAT, v: VERSION, doc: docJSON });
}

/**
 * @param {unknown} content stored `content` field
 * @returns {object | null} doc JSON, or null when unsupported
 */
export function parseDoc(content) {
    if (typeof content !== 'string' || !content.startsWith('{')) return null;
    try {
        const data = JSON.parse(content);
        if (!data || data.format !== FORMAT) return null;
        if (typeof data.v !== 'number' || data.v > VERSION) return null;
        if (!data.doc || data.doc.type !== 'doc' || !Array.isArray(data.doc.content)) return null;
        return data.doc;
    } catch {
        return null;
    }
}

/** Whether stored content can be opened by this version. Empty content is a new document. */
export function isSupportedContent(content) {
    if (content == null || content === '') return true;
    return parseDoc(content) !== null;
}

/** Plain text of a doc JSON (blocks separated by newlines). */
export function docPlainText(docJSON) {
    const out = [];
    const walk = (node) => {
        if (!node) return;
        if (node.type === 'text') {
            out.push(node.text || '');
            return;
        }
        if (node.type === 'hardBreak') {
            out.push('\n');
            return;
        }
        const isBlock = node.type === 'paragraph';
        // A continuation is the same paragraph resumed on the next page.
        if (isBlock && node.attrs?.cont && out[out.length - 1] === '\n') out.pop();
        (node.content || []).forEach(walk);
        if (isBlock) out.push('\n');
    };
    walk(docJSON);
    return out.join('').replace(/\n+$/, '');
}

/** Diary page attributes in order: [{ hasHeader, fields }]. */
export function docPages(docJSON) {
    return (docJSON?.content || []).map((p) => ({
        hasHeader: Boolean(p.attrs?.hasHeader),
        fields: p.attrs?.fields || {},
    }));
}
