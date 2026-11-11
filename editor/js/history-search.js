/**
 * Sidebar search over History and Trash.
 *
 * A document matches when every word of the query appears somewhere in its
 * filename, its diary header fields (FIR, case-diary number, …) or its body
 * text, so "123 2026" finds FIR "123/2026".
 */
import { parseDoc, docPlainText, docPages } from './editor/doc-format.js';

/** Lower-case + collapse whitespace; locale-aware so Devanagari/Latin both fold. */
export function normalizeSearch(text) {
    return String(text ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Everything about a document that search can match, normalized.
 * Content this version cannot open contributes only its filename.
 * @param {{ filename?: string, content?: string }} doc
 * @returns {string}
 */
export function searchableText(doc) {
    const parts = [doc.filename || ''];
    const json = parseDoc(doc.content);
    if (json) {
        for (const page of docPages(json)) {
            // rule_no is pre-filled on every diary, so it would match everything.
            for (const [key, value] of Object.entries(page.fields || {})) {
                if (key !== 'rule_no') parts.push(String(value ?? ''));
            }
        }
        parts.push(docPlainText(json));
    }
    return normalizeSearch(parts.join(' '));
}

/**
 * @param {string} haystack output of `searchableText`
 * @param {string} query raw user input
 */
export function matchesQuery(haystack, query) {
    const words = normalizeSearch(query).split(' ').filter(Boolean);
    return words.every((word) => haystack.includes(word));
}
