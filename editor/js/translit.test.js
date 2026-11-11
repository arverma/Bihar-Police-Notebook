import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchSuggestions, shouldSkipTransliteration, splitWordPunctuation } from './translit.js';

test('shouldSkipTransliteration skips english uppercase acronyms', () => {
    expect(shouldSkipTransliteration('IPC')).toBe(true);
    expect(shouldSkipTransliteration('CrPC')).toBe(true);
    expect(shouldSkipTransliteration('FIR')).toBe(true);
});

test('shouldSkipTransliteration skips pure numbers and punctuation', () => {
    expect(shouldSkipTransliteration('123')).toBe(true);
    expect(shouldSkipTransliteration('12.3')).toBe(true);
    expect(shouldSkipTransliteration('45,67')).toBe(true);
});

test('shouldSkipTransliteration does NOT skip lowercase hinglish words', () => {
    expect(shouldSkipTransliteration('bihar')).toBe(false);
    expect(shouldSkipTransliteration('patna')).toBe(false);
});

test('splitWordPunctuation separates surrounding punctuation only', () => {
    expect(splitWordPunctuation('jeevan,')).toEqual({ lead: '', core: 'jeevan', trail: ',' });
    expect(splitWordPunctuation('(kya?)')).toEqual({ lead: '(', core: 'kya', trail: '?)' });
    expect(splitWordPunctuation("ma'am.")).toEqual({ lead: '', core: "ma'am", trail: '.' });
    expect(splitWordPunctuation('जीवन,')).toEqual({ lead: '', core: 'जीवन', trail: ',' });
    expect(splitWordPunctuation('...')).toEqual({ lead: '...', core: '', trail: '' });
});

describe('fetchSuggestions keeps punctuation', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (url) => ({
            ok: true,
            json: async () => ['SUCCESS', [[decodeURIComponent(String(url).match(/text=([^&]*)/)[1]), ['जीवन', 'जीवण'], [], {}]]],
        })));
    });
    afterEach(() => vi.unstubAllGlobals());

    test('trailing and leading punctuation survive on every suggestion', async () => {
        expect(await fetchSuggestions('jeevankm,')).toEqual(['जीवन,', 'जीवण,']);
        expect(await fetchSuggestions('(jeevankn?)')).toEqual(['(जीवन?)', '(जीवण?)']);
    });

    test('the API only sees the punctuation-free word', async () => {
        await fetchSuggestions('jeevankp,');
        expect(fetch.mock.calls.at(-1)[0]).toContain('text=jeevankp&');
    });

    test('already-Devanagari text and bare punctuation give no suggestions', async () => {
        expect(await fetchSuggestions('जीवन,')).toEqual([]);
        expect(await fetchSuggestions('...')).toEqual([]);
    });
});
