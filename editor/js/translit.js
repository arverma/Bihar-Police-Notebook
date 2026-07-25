/**
 * Hindi transliteration via Google Input Tools API.
 * Requires internet connectivity.
 */

const cache = Object.create(null);

/**
 * Fetch up to 5 Devanagari suggestions for a Hinglish word.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
export async function fetchSuggestions(word) {
    if (!word || !word.trim()) return [];
    const key = word.trim();
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
            suggestions = data[1][0][1].slice(0, 5);
        }

        cache[key] = suggestions;
        return suggestions;
    } catch (err) {
        console.error('Transliteration error:', err);
        return [];
    }
}
