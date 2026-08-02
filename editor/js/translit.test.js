import { expect, test } from 'vitest';
import { shouldSkipTransliteration } from './translit.js';

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
