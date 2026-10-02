/**
 * Diary sheet: the A4 case-diary form (header + two-column body) as one
 * paged document editor, plus the document-title helpers the app uses.
 */
import { createDocSheet } from './editor/doc-sheet.js';

export { DIARY_NON_TRANSLIT_HEADER_FIELDS, HEADER_FIELDS, emptyHeader } from './editor/diary-geometry.js';

/**
 * @param {string} createdAtIso
 * @returns {string}
 */
export function formatDiaryDocFilename(createdAtIso) {
  return new Date(createdAtIso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * First non-empty FIR number across page headers.
 * @param {Array<{ fields?: Record<string, string> }>} pages
 * @returns {string}
 */
export function diaryFirNumber(pages) {
  for (const p of pages || []) {
    const fir = String(p?.fields?.fir_number ?? '').trim();
    if (fir) return fir;
  }
  return '';
}

/**
 * Auto diary title: FIR when present, else created date.
 * @param {string} createdAtIso
 * @param {string} [fir]
 * @returns {string}
 */
export function autoDiaryFilename(createdAtIso, fir) {
  const trimmed = String(fir ?? '').trim();
  if (trimmed) return trimmed;
  return formatDiaryDocFilename(createdAtIso);
}

/**
 * Whether the filename is still auto-managed (date default or current FIR).
 * @param {string} name
 * @param {string} createdAtIso
 * @param {string} [fir]
 * @returns {boolean}
 */
export function isAutoDiaryFilename(name, createdAtIso, fir) {
  const n = String(name ?? '').trim();
  if (!n) return true;
  if (n === formatDiaryDocFilename(createdAtIso)) return true;
  const firTrim = String(fir ?? '').trim();
  return Boolean(firTrim && n === firTrim);
}

/**
 * @param {HTMLElement} container
 * @param {import('./editor/doc-sheet.js').SheetHooks} hooks
 */
export function initDiarySheet(container, hooks) {
  const sheet = createDocSheet(container, 'diary', hooks);
  return {
    ...sheet,
    /** FIR number from the page headers (drives the auto document title). */
    firNumber: () => diaryFirNumber(sheet.getPages()),
    get pageCount() { return sheet.pageCount; },
  };
}
