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

/**
 * Fetch up to 5 Devanagari suggestions for a Hinglish word.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
export async function fetchSuggestions(word) {
    if (!word || !word.trim()) return [];
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
