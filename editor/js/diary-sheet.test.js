/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  autoDiaryFilename,
  diaryFirNumber,
  emptyModel,
  isAutoDiaryFilename,
  formatDiaryDocFilename,
} from './diary-sheet.js';

const CREATED = '2026-08-01T10:00:00.000Z';

test('diaryFirNumber reads from pages header', () => {
  const model = {
    pages: [{ header: { fir_number: '  FIR-42  ' }, left: '', right: '' }],
  };
  expect(diaryFirNumber(model)).toBe('FIR-42');
  expect(diaryFirNumber(emptyModel())).toBe('');
});

test('autoDiaryFilename prefers FIR over date', () => {
  expect(autoDiaryFilename(CREATED, '')).toBe(formatDiaryDocFilename(CREATED));
  expect(autoDiaryFilename(CREATED, '123/2026')).toBe('123/2026');
});

test('isAutoDiaryFilename detects date default and FIR match', () => {
  const dateName = formatDiaryDocFilename(CREATED);
  expect(isAutoDiaryFilename(dateName, CREATED, '')).toBe(true);
  expect(isAutoDiaryFilename('123/2026', CREATED, '123/2026')).toBe(true);
  expect(isAutoDiaryFilename('My custom case', CREATED, '123/2026')).toBe(false);
});
