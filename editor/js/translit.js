/**
 * Hindi transliteration via Google Input Tools API.
 * Requires internet connectivity.
 * Western digits (0–9) are kept as ASCII; Devanagari numerals in results are normalized.
 */

const cache = Object.create(null);

const DEV_DIGITS = '०१२३४५६७८९';

/** Pure number tokens (digits + common separators) — do not transliterate. */
const PURE_NUMBER_RE = /^[\d.,\-\/]+$/;

/** Shift-typed English (any A–Z) — keep as-is for diary acronyms like IPC, FIR. */
const HAS_LATIN_UPPER_RE = /[A-Z]/;

/**
 * @param {string} word
 * @returns {boolean}
 */
export function shouldSkipTransliteration(word) {
    const key = String(word ?? '').trim();
    if (!key) return true;
    if (PURE_NUMBER_RE.test(key)) return true;
    if (HAS_LATIN_UPPER_RE.test(key)) return true;
    return false;
}

/**
 * @param {string} s
 * @returns {string}
 */
function toAsciiDigits(s) {
    return String(s).replace(/[०-९]/g, (ch) => String(DEV_DIGITS.indexOf(ch)));
}

const LEADING_PUNCT_RE = /^[^\p{L}\p{M}\p{N}]+/u;
const TRAILING_PUNCT_RE = /[^\p{L}\p{M}\p{N}]+$/u;
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const LATIN_RE = /[A-Za-z]/;

/**
 * Split a whitespace-delimited token into surrounding punctuation and the
 * word itself: `"(jeevan,"` -> `{ lead: '(', core: 'jeevan', trail: ',' }`.
 * Inner punctuation (`ma'am`, `1,000`) stays in the core.
 * @param {string} token
 * @returns {{ lead: string, core: string, trail: string }}
 */
export function splitWordPunctuation(token) {
    const s = String(token ?? '');
    const lead = s.match(LEADING_PUNCT_RE)?.[0] ?? '';
    const rest = s.slice(lead.length);
    const trail = rest.match(TRAILING_PUNCT_RE)?.[0] ?? '';
    return { lead, core: rest.slice(0, rest.length - trail.length), trail };
}

/**
 * Fetch up to 5 Devanagari suggestions for a Hinglish word. Punctuation around
 * the word is not transliterated: it is kept and re-attached to every
 * suggestion, so accepting one never drops it. Text that is already Devanagari
 * has nothing to convert and yields no suggestions.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
export async function fetchSuggestions(word) {
    if (!word || !word.trim()) return [];
    const { lead, core, trail } = splitWordPunctuation(word.trim());
    if (!core) return [];
    if (DEVANAGARI_RE.test(core) && !LATIN_RE.test(core)) return [];
    const suggestions = await fetchCoreSuggestions(core);
    return lead || trail ? suggestions.map((s) => lead + s + trail) : suggestions;
}

/**
 * @param {string} word punctuation-free word
 * @returns {Promise<string[]>}
 */
async function fetchCoreSuggestions(word) {
    const key = word.trim();
    if (shouldSkipTransliteration(key)) return [];
    if (cache[key]) return cache[key];

    try {
        const url =
            'https://inputtools.google.com/request' +
            `?text=${encodeURIComponent(key)}` +
            '&itc=hi-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8';

        const res = await fetch(url);
        if (!res.ok) return [];

        const data = await res.json();
        // Response shape: ["SUCCESS", [[input, [s1, s2, ...], [], {...}]]]
        let suggestions = [];
        if (
            Array.isArray(data) &&
            data[0] === 'SUCCESS' &&
            Array.isArray(data[1]) &&
            Array.isArray(data[1][0]) &&
            Array.isArray(data[1][0][1])
        ) {
            suggestions = data[1][0][1].slice(0, 5).map(toAsciiDigits);
        }

        cache[key] = suggestions;
        return suggestions;
    } catch (err) {
        console.error('Transliteration error:', err);
        return [];
    }
}
