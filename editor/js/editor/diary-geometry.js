/**
 * A4 diary geometry and header fields.
 *
 * Margin is half the Google Docs default (0.5in / 12.7mm). Writing boxes snap
 * to whole 24px lines so no line is ever split across a page edge.
 */

const DPI = 96;
const MM_PER_IN = 25.4;
const mmToPx = (mm) => (mm / MM_PER_IN) * DPI;

const PAGE_H_MM = 297;
const MARGIN_MM = 12.7;
export const LINE_HEIGHT_PX = 24;
export const LEFT_COL_PCT = 20;

const PAGE_H_PX = mmToPx(PAGE_H_MM);
const MARGIN_PX = mmToPx(MARGIN_MM);
const CONTENT_H_RAW_PX = PAGE_H_PX - 2 * MARGIN_PX; // ~1026.52

/** Minimum heights for the header block and titles row when shown. */
export const HEADER_BLOCK_H_PX = 140;
export const TITLES_ROW_H_PX = 72;
/** Matches .diary-page-header margin-bottom. */
const HEADER_MARGIN_BOTTOM_PX = 4;
/**
 * Outer border of the bordered table, which sits outside the writing box and
 * must be reserved so the bottom rule is not clipped off the printed page.
 */
const TABLE_BORDER_H_PX = 4;

export function linesFor(availablePx) {
    return Math.floor(availablePx / LINE_HEIGHT_PX);
}

/**
 * Height of the writing boxes on a page, including the filler that stretches
 * them to the bottom margin.
 * @param {boolean} hasHeader
 * @param {number} [headerBlockH] measured header block px
 * @param {number} [titlesRowH] measured titles row px
 */
export function diaryBoxHeightPx(hasHeader, headerBlockH = HEADER_BLOCK_H_PX, titlesRowH = TITLES_ROW_H_PX) {
    const headerTotal = hasHeader
        ? Math.max(HEADER_BLOCK_H_PX, headerBlockH) + HEADER_MARGIN_BOTTOM_PX + Math.max(TITLES_ROW_H_PX, titlesRowH)
        : 0;
    const available = CONTENT_H_RAW_PX - headerTotal - TABLE_BORDER_H_PX;
    const box = Math.max(LINE_HEIGHT_PX, linesFor(available) * LINE_HEIGHT_PX);
    const filler = Math.max(0, available - box);
    return box + filler;
}

export const HEADER_FIELDS = [
    'case_diary_no', 'rule_no', 'against_1', 'against_2', 'special_report_no',
    'thana', 'district', 'fir_number', 'fir_date', 'event_date_place',
    'sections', 'investigation_record',
];

/** Header fields that must not use Hinglish transliteration (numbers, refs). */
export const DIARY_NON_TRANSLIT_HEADER_FIELDS = new Set([
    'fir_number', 'case_diary_no', 'rule_no', 'special_report_no', 'sections',
]);

export function emptyHeader() {
    const h = {};
    HEADER_FIELDS.forEach((k) => { h[k] = ''; });
    h.rule_no = '164';
    return h;
}

/**
 * Header for a page that is switching its header on: copy the nearest earlier
 * header and advance the case-diary number.
 * @param {Array<{hasHeader:boolean, fields:object}>} pagesBefore
 */
export function prefilledHeader(pagesBefore) {
    for (let i = pagesBefore.length - 1; i >= 0; i--) {
        const p = pagesBefore[i];
        if (p.hasHeader && p.fields) {
            const next = { ...emptyHeader(), ...p.fields };
            const num = parseInt(next.case_diary_no, 10);
            if (!Number.isNaN(num)) next.case_diary_no = String(num + 1);
            return next;
        }
    }
    return emptyHeader();
}

/** Date input value (YYYY-MM-DD) shown as dd/mm/yyyy in print. */
export function formatHeaderDate(v) {
    const s = String(v ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
}
