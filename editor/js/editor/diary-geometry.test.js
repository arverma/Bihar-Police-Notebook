import { expect, test } from 'vitest';
import {
    diaryBoxHeightPx, LINE_HEIGHT_PX, HEADER_BLOCK_H_PX, TITLES_ROW_H_PX,
    prefilledHeader, emptyHeader, formatHeaderDate,
} from './diary-geometry.js';

// A4 at 96dpi with 12.7mm margins leaves ~1026.52px of content height.
const CONTENT_H = (297 / 25.4) * 96 - 2 * ((12.7 / 25.4) * 96);

test('boxes fill the page down to the bottom margin', () => {
    const withHeader = diaryBoxHeightPx(true);
    expect(withHeader).toBeCloseTo(CONTENT_H - HEADER_BLOCK_H_PX - 4 - TITLES_ROW_H_PX - 4, 5);
    expect(diaryBoxHeightPx(false)).toBeCloseTo(CONTENT_H - 4, 5);
});

test('a taller header (wrapped fields) shrinks the box by whole lines', () => {
    const lines = (h) => Math.floor(h / LINE_HEIGHT_PX);
    expect(lines(diaryBoxHeightPx(true, HEADER_BLOCK_H_PX + 30))).toBeLessThan(lines(diaryBoxHeightPx(true)));
    // Measured heights below the minimum are clamped up.
    expect(diaryBoxHeightPx(true, 10, 10)).toBe(diaryBoxHeightPx(true));
});

test('prefilledHeader copies the nearest earlier header and advances the case-diary number', () => {
    const pages = [
        { hasHeader: true, fields: { ...emptyHeader(), case_diary_no: '7', thana: 'कोतवाली' } },
        { hasHeader: false, fields: emptyHeader() },
    ];
    const next = prefilledHeader(pages);
    expect(next.case_diary_no).toBe('8');
    expect(next.thana).toBe('कोतवाली');
    expect(prefilledHeader([])).toEqual(emptyHeader());
});

test('formatHeaderDate prints date inputs as dd/mm/yyyy', () => {
    expect(formatHeaderDate('2026-08-04')).toBe('04/08/2026');
    expect(formatHeaderDate('free text')).toBe('free text');
});
