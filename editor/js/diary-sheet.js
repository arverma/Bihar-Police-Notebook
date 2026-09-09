/**
 * A4 paged diary sheet — geometry + page UI + print helpers.
 *
 * Margin is half the Google Docs default (0.5in / 12.7mm).
 * Box heights snap to whole 24px lines so no line splits across pages.
 */

import {
  caretIndexAfterTextChange,
  mountQuill,
  quillIndexFromClientPoint,
  sanitizeQuillHtml,
  splitRichToFit,
  stripHtmlToPlain,
} from './quill-pages.js';
import {
  joinRightSpillOntoNext,
  measureRichFits,
  peelLastContentUnit,
  prependPeeledBlock,
  takeFirstContentUnit,
  takeFittingHtmlPrefix,
} from './page-fit.js';
import { createEditHistory } from './edit-history.js';
import { createCaretOwnership } from './caret-ownership.js';

const DPI = 96;
const MM_PER_IN = 25.4;

function mmToPx(mm) {
  return (mm / MM_PER_IN) * DPI;
}

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 12.7; // half of Google Docs 1in
const FONT_PX = 15;
const LINE_HEIGHT_PX = 24;
const LEFT_COL_PCT = 20;

const PAGE_W_PX = mmToPx(PAGE_W_MM);
const PAGE_H_PX = mmToPx(PAGE_H_MM);
const MARGIN_PX = mmToPx(MARGIN_MM); // 48

const CONTENT_H_RAW_PX = PAGE_H_PX - 2 * MARGIN_PX; // ~1026.52
const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM; // 184.6
const CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_MM; // 271.6
const CONTENT_W_PX = mmToPx(CONTENT_W_MM);

/** Fixed heights for header block + titles row when shown */
const HEADER_BLOCK_H_PX = 140;
const TITLES_ROW_H_PX = 72;
/** Matches .diary-page-header / .diary-print-header margin-bottom */
const HEADER_MARGIN_BOTTOM_PX = 4;

/**
 * Outer border of the bordered table, which sits outside the writing box and
 * must be reserved so the bottom rule is not clipped off the printed page.
 */
const TABLE_BORDER_H_PX = 4;
const TABLE_BORDER_W_PX = 4;
const HEADER_TOTAL_H_PX = HEADER_BLOCK_H_PX + HEADER_MARGIN_BOTTOM_PX + TITLES_ROW_H_PX;

function linesFor(availablePx) {
  return Math.floor(availablePx / LINE_HEIGHT_PX);
}

const BOX_LINES_WITH_HEADER = linesFor(CONTENT_H_RAW_PX - HEADER_TOTAL_H_PX);
const BOX_LINES_NO_HEADER = linesFor(CONTENT_H_RAW_PX - TABLE_BORDER_H_PX);
const BOX_H_WITH_HEADER_PX = BOX_LINES_WITH_HEADER * LINE_HEIGHT_PX;
const BOX_H_NO_HEADER_PX = BOX_LINES_NO_HEADER * LINE_HEIGHT_PX;

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

export function emptyModel() {
  return {
    pages: [{ hasHeader: true, header: emptyHeader(), left: '', right: '' }],
  };
}

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
 * First non-empty FIR number from page headers.
 * @param {object} model
 * @returns {string}
 */
export function diaryFirNumber(model) {
  if (!model || typeof model !== 'object') return '';
  const pages = Array.isArray(model.pages) ? model.pages : [];
  for (const p of pages) {
    const fir = String(p?.header?.fir_number ?? '').trim();
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
  const dateDefault = formatDiaryDocFilename(createdAtIso);
  const firTrim = String(fir ?? '').trim();
  if (n === dateDefault) return true;
  if (firTrim && n === firTrim) return true;
  return false;
}

/**
 * Normalize stored content into { pages }.
 * Supports legacy flat { left_box, right_box, ...fields } shape,
 * and migrates global `header` to per-page `header`.
 */
export function normalizeDiaryModel(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch (_) { data = {}; }
  }
  if (!data || typeof data !== 'object') data = {};

  const globalHeaderFallback = emptyHeader();
  HEADER_FIELDS.forEach((k) => {
    if (data.header && k in data.header) globalHeaderFallback[k] = data.header[k] ?? '';
    else if (k in data) globalHeaderFallback[k] = data[k] ?? '';
  });

  if (Array.isArray(data.pages)) {
    const pages = data.pages.map((p, i) => {
      const hasHeader = p.hasHeader != null ? Boolean(p.hasHeader) : i === 0;
      let header = null;
      if (p.header) {
        header = emptyHeader();
        HEADER_FIELDS.forEach((k) => {
          if (k in p.header) header[k] = p.header[k] ?? '';
        });
      } else if (hasHeader) {
        header = { ...globalHeaderFallback };
      }
      return {
        hasHeader,
        header,
        left: p.left ?? '',
        right: p.right ?? '',
      };
    });
    if (!pages.length) pages.push({ hasHeader: true, header: { ...globalHeaderFallback }, left: '', right: '' });
    return { pages };
  }

  // Legacy flat format
  return {
    pages: [{
      hasHeader: true,
      header: { ...globalHeaderFallback },
      left: data.left_box ?? '',
      right: data.right_box ?? '',
    }],
  };
}

export function diaryHasMeaningfulContent(model) {
  const m = normalizeDiaryModel(model);
  const anyHeader = m.pages.some((p) => p.header && Object.values(p.header).some((v) => String(v).trim()));
  const anyText = m.pages.some((p) => {
    const left = String(p.left || '').trim();
    const right = stripHtmlToPlain(p.right || '').trim();
    return left || right;
  });
  return anyHeader || anyText;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Body writing-box height for a page.
 * @param {boolean} hasHeader
 * @param {number} [headerBlockH] measured header block px (min HEADER_BLOCK_H_PX)
 * @param {number} [titlesRowH] measured titles row px (min TITLES_ROW_H_PX)
 */
function boxHeightPx(
  hasHeader,
  headerBlockH = HEADER_BLOCK_H_PX,
  titlesRowH = TITLES_ROW_H_PX,
) {
  if (!hasHeader) return BOX_H_NO_HEADER_PX;
  const h = Math.max(HEADER_BLOCK_H_PX, headerBlockH);
  const titlesH = Math.max(TITLES_ROW_H_PX, titlesRowH);
  const headerTotal = h + HEADER_MARGIN_BOTTOM_PX + titlesH;
  const lines = linesFor(CONTENT_H_RAW_PX - headerTotal - TABLE_BORDER_H_PX);
  return Math.max(LINE_HEIGHT_PX, lines * LINE_HEIGHT_PX);
}

/**
 * @param {boolean} hasHeader
 * @param {number} [headerBlockH]
 * @param {number} [titlesRowH]
 */
function cellPadBottomPx(
  hasHeader,
  headerBlockH = HEADER_BLOCK_H_PX,
  titlesRowH = TITLES_ROW_H_PX,
) {
  const hBlock = hasHeader ? Math.max(HEADER_BLOCK_H_PX, headerBlockH) : 0;
  const titlesH = hasHeader ? Math.max(TITLES_ROW_H_PX, titlesRowH) : 0;
  const headerTotal = hasHeader ? hBlock + HEADER_MARGIN_BOTTOM_PX + titlesH : 0;
  const used = headerTotal + boxHeightPx(hasHeader, headerBlockH, titlesRowH) + TABLE_BORDER_H_PX;
  return Math.max(0, CONTENT_H_RAW_PX - used);
}

/** Print CSS shared by export window and offscreen header measurement. */
function diaryHeaderPrintCssFragment() {
  return `
    .diary-print-header {
      flex: 0 0 auto;
      box-sizing: border-box;
      font-family: 'Noto Sans Devanagari', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      margin: 0 0 4px;
      padding: 0;
      color: #000;
    }
    .diary-print-header .top-row {
      display: grid;
      grid-template-columns: minmax(100px, 0.85fr) minmax(160px, 1.15fr) minmax(240px, 1.6fr);
      grid-template-rows: auto auto auto auto;
      column-gap: 10px;
      row-gap: 2px;
      align-items: baseline;
    }
    .diary-print-header .sched-1,
    .diary-print-header .sched-2 {
      grid-column: 1;
      font-size: 11px;
      line-height: 1.35;
    }
    .diary-print-header .sched-1 { grid-row: 1; }
    .diary-print-header .sched-2 { grid-row: 2; }
    .diary-print-header .title-line {
      grid-column: 2;
      grid-row: 2;
      display: flex;
      align-items: baseline;
      justify-content: center;
      flex-wrap: nowrap;
      font-size: 16px;
      font-weight: 700;
      justify-self: center;
      transform: translateX(42px);
    }
    .diary-print-header .rule {
      grid-column: 2;
      grid-row: 3;
      display: flex;
      align-items: baseline;
      justify-content: center;
      font-size: 12px;
      font-weight: 400;
      justify-self: center;
      transform: translateX(42px);
    }
    .diary-print-header .against-line,
    .diary-print-header .special-line {
      grid-column: 3;
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      flex-wrap: nowrap;
      font-size: 12px;
      justify-self: end;
      width: 100%;
    }
    .diary-print-header .against-line { grid-row: 3; }
    .diary-print-header .special-line { grid-row: 4; }
    .diary-print-header .dotted {
      display: inline-block;
      min-width: 72px;
      border-bottom: 1px dotted #000;
      text-align: center;
      padding: 0 0.35em;
      margin: 0 0.25em;
      vertical-align: baseline;
      line-height: 1.35;
      box-sizing: content-box;
    }
    .diary-print-header .dotted.wide {
      min-width: 0;
      width: 28%;
    }
    .diary-print-header .dotted.narrow { min-width: 56px; }
    .diary-print-header .dotted.against {
      min-width: 52px;
      width: 88px;
      max-width: 88px;
    }
    .diary-print-header .dotted.special {
      min-width: 4.5em;
      width: 9.5em;
      max-width: 9.5em;
    }
    .diary-print-header .dotted.thana,
    .diary-print-header .dotted.district {
      min-width: 72px;
      width: 18%;
    }
    .diary-print-header .dotted.fir-no {
      min-width: 56px;
      max-width: 88px;
    }
    .diary-print-header .meta-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: baseline;
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.7;
    }
    .diary-print-header .meta-row .dotted.wide {
      flex: 1 1 0;
      width: auto;
      min-width: 80px;
    }
    .diary-print-header .meta-row .dotted.thana,
    .diary-print-header .meta-row .dotted.district {
      flex: 1 1 0;
      width: auto;
    }
    .diary-print-header .meta-row-flow {
      display: block;
      line-height: 1.7;
    }
    .diary-print-header .meta-row-flow .dotted.wide {
      display: inline;
      flex: none;
      width: auto;
      min-width: 4em;
      max-width: none;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: normal;
      text-align: left;
      padding: 0 4ch;
    }
  `;
}

/**
 * Measure print header height for the given header model (min HEADER_BLOCK_H_PX).
 * @param {Record<string, string>} header
 * @returns {number}
 */
export function measureHeaderHeightPx(header) {
  if (typeof document === 'undefined') return HEADER_BLOCK_H_PX;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    `width:${CONTENT_W_PX}px`,
    'visibility:hidden',
    'pointer-events:none',
  ].join(';');
  const style = document.createElement('style');
  style.textContent = diaryHeaderPrintCssFragment();
  host.appendChild(style);
  const mount = document.createElement('div');
  mount.innerHTML = printHeaderHtml(header || emptyHeader());
  host.appendChild(mount);
  document.body.appendChild(host);
  const el = mount.querySelector('.diary-print-header');
  const h = el ? el.getBoundingClientRect().height : HEADER_BLOCK_H_PX;
  document.body.removeChild(host);
  return Math.max(HEADER_BLOCK_H_PX, Math.ceil(h));
}

/**
 * Measure titles-row height at the current left/right column ratio
 * (narrow left col wraps the Hindi heading and can exceed TITLES_ROW_H_PX).
 * @param {string} [investigationRecord]
 * @returns {number}
 */
export function measureTitlesRowHeightPx(investigationRecord = '') {
  if (typeof document === 'undefined') return TITLES_ROW_H_PX;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    `width:${CONTENT_W_PX}px`,
    'visibility:hidden',
    'pointer-events:none',
  ].join(';');
  const style = document.createElement('style');
  style.textContent = `
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1.5px solid #000;
      font-family: 'Noto Sans Devanagari', Arial, sans-serif;
    }
    th {
      border: 1px solid #000;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      line-height: 1.3;
      min-height: ${TITLES_ROW_H_PX}px;
      padding: 6px 8px;
      box-sizing: border-box;
    }
    th.left-col { width: ${LEFT_COL_PCT}%; }
    th.right-col { width: ${100 - LEFT_COL_PCT}%; }
  `;
  host.appendChild(style);
  const inv = investigationRecord && String(investigationRecord).trim()
    ? `<div>(${escapeHtml(investigationRecord)})</div>`
    : '';
  const mount = document.createElement('div');
  mount.innerHTML = `
    <table>
      <tr class="titles-row">
        <th class="left-col">किन तिथि को (समय सहित) कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया</th>
        <th class="right-col">अन्वेषण का अभिलेख${inv}</th>
      </tr>
    </table>
  `;
  host.appendChild(mount);
  document.body.appendChild(host);
  const row = mount.querySelector('.titles-row');
  const h = row ? row.getBoundingClientRect().height : TITLES_ROW_H_PX;
  document.body.removeChild(host);
  return Math.max(TITLES_ROW_H_PX, Math.ceil(h));
}

function printHeaderHtml(header) {
  const dotted = (k, cls = '') => {
    let v = header[k];
    if (k === 'fir_date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
      const [y, m, d] = v.trim().split('-');
      v = `${d}/${m}/${y}`;
    }
    const text = v && String(v).trim() ? escapeHtml(v) : '&nbsp;';
    const className = cls ? `dotted ${cls}` : 'dotted';
    return `<span class="${className}">${text}</span>`;
  };
  return `
    <div class="diary-print-header">
      <div class="top-row">
        <div class="sched-1">अनुसूची 47, प्रपत्र सं० 120 अ</div>
        <div class="sched-2">आ० ह० प्रपत्र सं० 30 अ</div>
        <div class="title-line">
          केस-दैनिकी सं० ${dotted('case_diary_no')}
        </div>
        <div class="rule">(नियम-164)</div>
        <div class="against-line">
          ${dotted('against_1', 'against')} बनाम ${dotted('against_2', 'against')}
        </div>
        <div class="special-line">
          विशेष रिपोर्ट केस सं० ${dotted('special_report_no', 'special')}
        </div>
      </div>
      <div class="meta-row">
        थाना ${dotted('thana', 'thana')}
        जिला ${dotted('district', 'district')}
        प्रथम इत्तिला रिपोर्ट सं० ${dotted('fir_number', 'fir-no')}
        तिथि ${dotted('fir_date')}
      </div>
      <div class="meta-row meta-row-flow">
        घटना की तिथि और स्थान ${dotted('event_date_place', 'wide')}
        धारा ${dotted('sections', 'wide')}
      </div>
    </div>
  `;
}

/**
 * Plain-text length of a column slice (left = raw, right = stripped HTML).
 * @param {string} text
 * @param {'left'|'right'} col
 * @returns {number}
 */
export function columnTextLength(text, col) {
  if (col === 'left') return String(text ?? '').length;
  return stripHtmlToPlain(text ?? '').length;
}

/**
 * Length of stored right-column content in Quill index space, where each block
 * boundary counts as one newline. Plain-text length alone undercounts empty
 * paragraphs, which shifts caret restore after reflow.
 * @param {string} content
 * @returns {number}
 */
export function quillTextLength(content) {
  const s = String(content ?? '');
  if (!s) return 0;
  if (!/<\s*(p|div|br|li)\b/i.test(s)) return stripHtmlToPlain(s).length;

  const holder = document.createElement('div');
  holder.innerHTML = s;
  const blocks = [...holder.children].filter(
    (el) => /^(P|DIV|LI)$/.test(el.tagName),
  );
  if (!blocks.length) return stripHtmlToPlain(s).length;
  return blocks
    .map((el) => (el.textContent || '').replace(/\u00a0/g, ' '))
    .join('\n')
    .length;
}

/**
 * Caret coordinate length of a column slice: characters for the left textarea,
 * Quill indices for the right editor.
 * @param {string} text
 * @param {'left'|'right'} col
 * @returns {number}
 */
export function caretColumnLength(text, col) {
  if (col === 'left') return String(text ?? '').length;
  return quillTextLength(text);
}

/**
 * Right-column pages are joined as block sequences, so every page junction
 * costs one newline in the joined caret space. Left-column text is joined raw.
 * @param {'left'|'right'} col
 * @returns {number}
 */
export function caretJunctionCost(col) {
  return col === 'right' ? 1 : 0;
}

/**
 * Offset of a page-local caret inside the column's joined caret space.
 * @param {number[]} lengths caret length of each page's column
 * @param {number} junction
 * @param {number} pageIndex
 * @param {number} localOffset
 * @returns {number}
 */
export function caretToGlobal(lengths, junction, pageIndex, localOffset) {
  let off = 0;
  for (let i = 0; i < pageIndex && i < lengths.length; i++) {
    off += lengths[i] + junction;
  }
  return off + Math.max(0, localOffset);
}

/**
 * Inverse of {@link caretToGlobal}, clamped into the available pages.
 * @param {number[]} lengths caret length of each page's column
 * @param {number} junction
 * @param {number} globalOffset
 * @returns {{ pageIndex: number, localOffset: number }}
 */
export function caretFromGlobal(lengths, junction, globalOffset) {
  if (!lengths.length) return { pageIndex: 0, localOffset: 0 };
  let remaining = Math.max(0, globalOffset);
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (remaining <= len || i === lengths.length - 1) {
      return { pageIndex: i, localOffset: Math.min(remaining, len) };
    }
    remaining -= len + junction;
  }
  return { pageIndex: lengths.length - 1, localOffset: 0 };
}

/**
 * Whether a page body is empty in both columns (headers ignored).
 * Right column uses Quill index space: a lone empty `<p>` is Quill's default
 * empty document; extra blank paragraphs occupy layout and must not collapse.
 * @param {{ left?: string, right?: string }} page
 * @returns {boolean}
 */
export function isPageBodyEmpty(page) {
  if (!page) return true;
  if (String(page.left || '').trim()) return false;
  const right = String(page.right || '');
  if (!right.trim()) return true;
  if (/<img\b/i.test(right)) return false;
  if (quillTextLength(right) > 0) return false;
  const holder = document.createElement('div');
  holder.innerHTML = right;
  const blocks = [...holder.children].filter((el) => /^(P|DIV|LI)$/.test(el.tagName));
  return blocks.length <= 1;
}

/**
 * Drop trailing pages that have no header and empty bodies. Never drops page 0,
 * and never drops a page at or before `keepIndex` (caret-owned blank spill page).
 * @param {Array<{hasHeader?: boolean, left?: string, right?: string}>} pages
 * @param {number} [keepIndex=0]
 * @returns {typeof pages}
 */
export function collapseTrailingEmptyPages(pages, keepIndex = 0) {
  if (!Array.isArray(pages) || pages.length <= 1) return pages;
  const floor = Math.max(0, keepIndex | 0);
  const next = pages.slice();
  while (
    next.length > 1
    && next.length - 1 > floor
    && !next[next.length - 1].hasHeader
    && isPageBodyEmpty(next[next.length - 1])
  ) {
    next.pop();
  }
  return next;
}

/**
 * Join two same-column slices for reflow (plain concat; matches spill today).
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function joinColumnContent(a, b) {
  return String(a ?? '') + String(b ?? '');
}

/**
 * Spill text that overflows a fixed-height textarea at the last whitespace
 * boundary that still fits.
 * @param {HTMLTextAreaElement} textarea
 * @returns {{ keep: string, spill: string }}
 */
export function splitOverflow(textarea) {
  const full = textarea.value;
  if (textarea.scrollHeight <= textarea.clientHeight + 1) {
    return { keep: full, spill: '' };
  }
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    textarea.value = full.slice(0, mid);
    if (textarea.scrollHeight <= textarea.clientHeight + 1) lo = mid;
    else hi = mid - 1;
  }
  let cut = lo;
  // Prefer breaking at whitespace near the cut
  const lookBack = full.lastIndexOf(' ', cut);
  const lookNl = full.lastIndexOf('\n', cut);
  const ws = Math.max(lookBack, lookNl);
  if (ws > cut * 0.6) cut = ws + 1;

  // Ensure the keep slice actually fits (whitespace snap can overshoot)
  textarea.value = full.slice(0, cut);
  while (cut > 0 && textarea.scrollHeight > textarea.clientHeight + 1) {
    const prev = Math.max(full.lastIndexOf('\n', cut - 2), full.lastIndexOf(' ', cut - 2));
    cut = prev > 0 ? prev + 1 : cut - 1;
    textarea.value = full.slice(0, cut);
  }

  return { keep: full.slice(0, cut), spill: full.slice(cut) };
}

/**
 * Width of a diary column's writing area. Measured from a live page when one
 * exists so the mirror wraps exactly like the on-screen cell (and therefore
 * like the print output); otherwise estimated from the collapsed table borders.
 */
function columnWidthPx(col) {
  const live = document.querySelector(`.diary-page [data-col="${col}"]`);
  if (live) {
    const editor = live.classList?.contains('ql-editor')
      ? live
      : live.querySelector?.('.ql-editor');
    if (editor && editor.clientWidth > 0) return editor.clientWidth;
    if (live.clientWidth > 0) return live.clientWidth;
  }
  const colPct = col === 'left' ? LEFT_COL_PCT : 100 - LEFT_COL_PCT;
  return ((CONTENT_W_PX - TABLE_BORDER_W_PX) * colPct) / 100;
}

/**
 * Split text to fit a diary column box without requiring a live page textarea.
 * @param {string} text
 * @param {'left'|'right'} col
 * @param {boolean} hasHeader
 * @param {number} [headerBlockH]
 * @param {number} [titlesRowH]
 * @param {{ shrinkPx?: number, boxWidth?: number, boxHeight?: number, styleSource?: HTMLElement | null }} [opts]
 *   `boxWidth`/`boxHeight` override the computed geometry with the live box, so
 *   offscreen layout measures the same space the user sees. `styleSource` is
 *   the live `.ql-editor` whose computed font/padding the mirror should clone.
 *   `shrinkPx` shaves the usable height for callers that must not overfill it.
 * @returns {{ keep: string, spill: string }}
 */
export function splitTextToFit(
  text,
  col,
  hasHeader,
  headerBlockH = HEADER_BLOCK_H_PX,
  titlesRowH = TITLES_ROW_H_PX,
  opts = {},
) {
  if (!text) return { keep: '', spill: '' };
  const computedH = boxHeightPx(hasHeader, headerBlockH, titlesRowH)
    + cellPadBottomPx(hasHeader, headerBlockH, titlesRowH);
  const boxH = Math.max(1, (opts.boxHeight || computedH) - Math.max(0, opts.shrinkPx || 0));
  const colW = opts.boxWidth || columnWidthPx(col);

  if (col === 'right') {
    return splitRichToFit(text, colW, boxH, {
      fontSize: FONT_PX,
      lineHeight: LINE_HEIGHT_PX,
      padding: '4px 6px',
      styleSource: opts.styleSource || null,
    });
  }

  const ta = document.createElement('textarea');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    `width:${colW}px`,
    `height:${boxH}px`,
    'box-sizing:border-box',
    'padding:4px 6px',
    'border:none',
    'margin:0',
    `font-size:${FONT_PX}px`,
    `line-height:${LINE_HEIGHT_PX}px`,
    "font-family:'Noto Sans Devanagari', Arial, sans-serif",
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
    'overflow:hidden',
    'resize:none',
  ].join(';');
  document.body.appendChild(ta);
  ta.value = text;
  const result = splitOverflow(ta);
  document.body.removeChild(ta);
  return result;
}

/**
 * Manage diary page cards inside a container.
 *
 * @param {HTMLElement} container  #diaryPages
 * @param {HTMLTemplateElement} template  #diaryPageTemplate
 * @param {{
 *   onChange: () => void,
 *   onAttachField: (el: HTMLElement) => void,
 *   onPageFocus?: (index: number, total: number) => void,
 * }} hooks
 */
export function initDiarySheet(container, template, hooks) {
  /** @type {{ pages: Array<{hasHeader:boolean,header:object|null,left:string,right:string}> }} */
  let model = emptyModel();
  let focusedPage = 0;
  let spilling = false;
  /** Cached measured header block height for hasHeader pages */
  let cachedHeaderBlockH = HEADER_BLOCK_H_PX;
  /** Cached measured titles-row height (grows when left col wraps) */
  let cachedTitlesRowH = TITLES_ROW_H_PX;
  /** @type {WeakMap<HTMLElement, object>} */
  const rightFields = new WeakMap();
  /**
   * Only this page index holds a live Quill; other right columns are static HTML.
   * Persistence remains pages[].
   * @type {number}
   */
  let activeRightPageIndex = 0;
  /** Invalidates stale double-rAF overflow rechecks after undo/setModel. */
  let reflowEpoch = 0;
  /**
   * Reflow restores the caret one or two frames late, so a restore scheduled by
   * one reflow can land after the user has clicked into a different page. This
   * keeps the newest caret intent winning.
   */
  const caretOwner = createCaretOwnership();
  const { noteUserCaret, asRestore: asCaretRestore } = caretOwner;
  const history = createEditHistory();
  /** @type {'left'|'right'} */
  let lastCaretCol = 'right';

  function notify() {
    hooks.onChange?.();
  }

  /**
   * Deferred caret restore that is dropped if the user takes the caret first,
   * or if undo/setModel has replaced the document underneath it.
   * @param {() => void} fn
   * @returns {() => void}
   */
  function ownedCaretRestore(fn) {
    const epoch = reflowEpoch;
    return caretOwner.owned(() => {
      if (epoch !== reflowEpoch) return;
      fn();
    });
  }

  /**
   * Caret target for a reflow that runs a frame or more after it was queued.
   * The live caret wins: replaying the offset captured before the first spill
   * would walk the caret back through every follow-up reflow.
   * @param {'left'|'right'} col
   * @param {number | null} fallback
   * @returns {number | null}
   */
  function freshCaretGlobal(col, fallback) {
    return readCaretGlobal(col)?.global ?? fallback;
  }

  /**
   * Where the caret is, whichever column holds it.
   * @returns {{ col: 'left'|'right', global: number } | null}
   */
  function readCaretAnyColumn() {
    for (const col of /** @type {const} */ (['right', 'left'])) {
      const read = readCaretGlobal(col);
      if (read) return { col, global: read.global };
    }
    return null;
  }

  /**
   * Carry the caret to the neighbouring page when an arrow key has run it into
   * a page edge.
   *
   * Every page is its own editor, so ArrowUp on the first line of page 2 —
   * or ArrowDown on the last line of page 1 — simply does nothing, and the
   * diary reads as a stack of separate boxes instead of one document.
   *
   * Detection is "the caret did not move", checked after the browser has had
   * its turn, rather than measuring line geometry: that way wrapped lines,
   * blank lines and Devanagari clusters need no special casing, and a press
   * that *could* move within the page is never stolen.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {string} key
   */
  function crossPageOnArrow(pageIndex, col, key) {
    const before = readCaretGlobal(col);
    if (!before) return;
    const forward = key === 'ArrowDown' || key === 'ArrowRight';
    const target = pageIndex + (forward ? 1 : -1);
    if (target < 0 || target >= model.pages.length) return;

    requestAnimationFrame(() => {
      if (spilling || history.applying) return;
      const after = readCaretGlobal(col);
      // Moved, or focus left the column entirely — leave it alone.
      if (!after || after.global !== before.global) return;
      if (target >= model.pages.length) return;

      // An arrow press is the user placing the caret, so it outranks any
      // restore the pager queued earlier.
      noteUserCaret();
      const startOfTarget = globalOffsetBeforePage(col, target);
      restoreCaretGlobal(
        col,
        forward ? startOfTarget : startOfTarget + caretPageLength(target, col),
      );
    });
  }

  /**
   * Delete at the end of page N is Backspace at the start of page N+1: the same
   * junction, the same merge, the same caret landing. Reuse that path rather
   * than growing a second implementation of it.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  function handleBoundaryDelete(pageIndex, col, e) {
    if (pageIndex + 1 >= model.pages.length) return false;
    return handleBoundaryBackspace(pageIndex + 1, col, e);
  }

  function notifyFocus(index) {
    focusedPage = index;
    hooks.onPageFocus?.(index + 1, model.pages.length);
  }

  /**
   * Deep clone of fitted pages[] + caret for session undo.
   * @returns {{ pages: object[], caret: { col: 'left'|'right', global: number } }}
   */
  function cloneSnapshot() {
    /** @type {{ col: 'left'|'right', global: number } | null} */
    let caret = null;
    for (const col of /** @type {const} */ (['right', 'left'])) {
      const read = readCaretGlobal(col);
      if (read) {
        lastCaretCol = col;
        caret = { col, global: read.global };
        break;
      }
    }
    if (!caret) {
      caret = { col: lastCaretCol, global: 0 };
    }
    return {
      pages: model.pages.map((p) => ({
        ...p,
        header: p.header ? { ...p.header } : null,
      })),
      caret,
    };
  }

  function settleHistory() {
    if (history.applying || spilling) return;
    history.settle(cloneSnapshot());
  }

  /**
   * @param {{ force?: boolean }} [opts]
   */
  function markUserEdit(opts = {}) {
    if (history.applying || spilling) return;
    history.markUserEdit(opts);
  }

  /**
   * Restore a history snapshot without clearing the undo stack (unlike setModel).
   * @param {{ pages: object[], caret?: { col: 'left'|'right', global: number } }} snap
   */
  function applySnapshot(snap) {
    reflowEpoch += 1;
    history.applying = true;
    model = {
      pages: (snap.pages || []).map((p) => ({
        ...p,
        header: p.header ? { ...p.header } : null,
      })),
    };
    if (!model.pages.length) model = emptyModel();
    const caret = snap.caret || { col: 'right', global: 0 };
    lastCaretCol = caret.col === 'left' ? 'left' : 'right';
    const modelLengths = model.pages.map((p) => caretColumnLength(p?.[lastCaretCol], lastCaretCol));
    const { pageIndex } = caretFromGlobal(
      modelLengths,
      caretJunctionCost(lastCaretCol),
      caret.global,
    );
    focusedPage = pageIndex;
    if (lastCaretCol === 'right') activeRightPageIndex = pageIndex;
    render({ skipRead: true });
    // Only the caret placement is droppable — the history bookkeeping below
    // must run whether or not the user has clicked elsewhere since.
    const restore = ownedCaretRestore(() => restoreCaretGlobal(caret.col, caret.global));
    requestAnimationFrame(() => {
      restore();
      history.applying = false;
      // A snapshot records content, not a layout. The one being restored may
      // have been captured against a different box — a diary stored on another
      // screen, or a state from before an open-repair — so it can arrive not
      // fitting its pages. render() does schedule an overflow check, but that
      // runs while `history.applying` is still true and bails, leaving the page
      // clipped with no way back. Re-fit once the flag is down.
      container.querySelectorAll('.diary-page').forEach((pageEl, i) => {
        checkOverflow(pageEl, i);
      });
      history.settle(cloneSnapshot());
      notify();
    });
  }

  function undo() {
    if (!history.canUndo) return false;
    const current = cloneSnapshot();
    history.settle(current);
    const snap = history.undoOnce();
    if (!snap) return false;
    applySnapshot(/** @type {{ pages: object[], caret?: { col: 'left'|'right', global: number } }} */ (snap));
    return true;
  }

  function redo() {
    if (!history.canRedo) return false;
    const current = cloneSnapshot();
    history.settle(current);
    const snap = history.redoOnce();
    if (!snap) return false;
    applySnapshot(/** @type {{ pages: object[], caret?: { col: 'left'|'right', global: number } }} */ (snap));
    return true;
  }

  function clearHistory() {
    history.clear();
    reflowEpoch += 1;
  }

  /**
   * Scroll container for the editor stage: mobile `#editorStage` when it
   * overflows, otherwise `main.main-content` (desktop).
   * @returns {HTMLElement | null}
   */
  function stageScrollEl() {
    const stage = document.getElementById('editorStage');
    if (stage instanceof HTMLElement
      && stage.scrollHeight > stage.clientHeight + 1) {
      return stage;
    }
    const main = document.querySelector('main.main-content');
    return main instanceof HTMLElement ? main : (stage instanceof HTMLElement ? stage : null);
  }

  /** @returns {{ el: HTMLElement, top: number, left: number } | null} */
  function snapshotStageScroll() {
    const el = stageScrollEl();
    if (!el) return null;
    return { el, top: el.scrollTop, left: el.scrollLeft };
  }

  /** @param {{ el: HTMLElement, top: number, left: number } | null} snap */
  function restoreStageScroll(snap) {
    if (!snap?.el) return;
    snap.el.scrollTop = snap.top;
    snap.el.scrollLeft = snap.left;
  }

  /**
   * @param {HTMLElement} host
   * @param {HTMLElement} pageEl
   * @param {string} html
   */
  function fillStaticRight(host, pageEl, html) {
    const existing = rightFields.get(pageEl);
    existing?.destroy?.();
    rightFields.delete(pageEl);
    host.innerHTML = '';
    host.classList.add('bp-ql-container', 'ql-container', 'ql-snow');
    const editor = document.createElement('div');
    editor.className = 'ql-editor bp-ql-editor hinglish-input';
    editor.setAttribute('contenteditable', 'false');
    // Sanitize so old stored `<p></p>` gains `<br>` and keeps line boxes.
    const raw = sanitizeQuillHtml(String(html || ''));
    if (!raw.trim()) {
      editor.innerHTML = '<p><br></p>';
    } else if (/<\s*(p|div|br|strong|em|u|ul|li|img)\b/i.test(raw)) {
      editor.innerHTML = raw;
    } else {
      editor.textContent = raw;
    }
    host.appendChild(editor);
    host.dataset.staticRight = '1';
    editor.scrollTop = 0;
  }

  /**
   * Mount a live Quill on a page's right column (destroys any prior field).
   * @param {HTMLElement} pageEl
   * @param {number} pageIndex
   * @returns {object | null}
   */
  function mountLiveRight(pageEl, pageIndex) {
    const rightHost = pageEl.querySelector('[data-col="right"]');
    if (!rightHost || rightHost instanceof HTMLTextAreaElement) return null;
    const existing = rightFields.get(pageEl);
    existing?.destroy?.();
    delete rightHost.dataset.staticRight;
    const placeholder = rightHost.getAttribute('data-placeholder') || 'यहाँ विवरण लिखें...';
    /** @type {ReturnType<typeof mountQuill> | null} */
    let field = null;
    field = mountQuill(rightHost, {
      placeholder,
      fixJustifyCaret: true,
      onFocus: () => {
        notifyFocus(pageIndex);
        activeRightPageIndex = pageIndex;
      },
      onChange: (html, meta) => {
        if (spilling || !field || history.applying) return;
        if (meta?.source === 'user') {
          lastCaretCol = 'right';
          markUserEdit();
        }
        model.pages[pageIndex].right = html;
        reflowRightAfterEdit(pageIndex, field, meta);
      },
    });
    field.setContent(model.pages[pageIndex].right || '');
    rightFields.set(pageEl, field);
    hooks.onAttachField?.(field.quill.root, field);

    // A pointer press inside the live editor is the user claiming the caret —
    // a reflow restore still in flight must not drag it away.
    caretOwner.watchUserCaret(field.quill.root);

    field.quill.root.addEventListener('compositionstart', () => {
      if (spilling || history.applying) return;
      lastCaretCol = 'right';
      markUserEdit();
    });

    field.quill.root.addEventListener('compositionend', () => {
      if (spilling || !field || history.applying) return;
      model.pages[pageIndex].right = field.getHtml();
      reflowRightAfterEdit(pageIndex, field, null);
    });

    field.quill.root.addEventListener('keydown', (e) => {
      // Freeze stage scroll on keyboard caret moves — native contenteditable
      // scrolls ancestors to reveal the caret; wheel/trackpad stay free.
      // Also pin the fixed box: ArrowDown must not set scrollTop > 0.
      if (
        e.key === 'Enter'
        || e.key === 'Backspace'
        || e.key === 'Delete'
        || e.key.startsWith('Arrow')
      ) {
        const snap = snapshotStageScroll();
        requestAnimationFrame(() => {
          restoreStageScroll(snap);
          clampRightScrollAndReflow(field, pageIndex);
        });
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Plain arrows walk the caret between pages; a shifted arrow is a
      // selection gesture and must not teleport it.
      if (e.key.startsWith('Arrow') && !e.shiftKey) {
        crossPageOnArrow(pageIndex, 'right', e.key);
        return;
      }

      const range = field.quill.getSelection();
      if (!range || range.length !== 0) return;

      if (e.key === 'Delete') {
        // Quill's length counts the trailing newline, so end-of-text is len-1.
        if (range.index >= Math.max(0, field.quill.getLength() - 1)) {
          handleBoundaryDelete(pageIndex, 'right', e);
        }
        return;
      }

      if (e.key !== 'Backspace' || range.index !== 0) return;
      handleBoundaryBackspace(pageIndex, 'right', e);
    });

    // Native caret reveal can set scrollTop even with overflow:hidden.
    field.quill.root.addEventListener('scroll', () => {
      if (field.quill.root.scrollTop === 0) return;
      clampRightScrollAndReflow(field, pageIndex);
    });
    return field;
  }

  /**
   * Continuous-right: ensure only pageIndex has a live Quill.
   * When activating from a static-page click, pass clientX/Y so the caret lands
   * on the same mousedown (DOM is replaced, so the browser cannot place it).
   * @param {number} pageIndex
   * @param {{ localOffset?: number, clientX?: number, clientY?: number }} [opts]
   */
  function activateRightPage(pageIndex, opts = {}) {
    const pageEls = container.querySelectorAll('.diary-page');
    pageEls.forEach((el, i) => {
      const host = el.querySelector('[data-col="right"]');
      if (!(host instanceof HTMLElement)) return;
      if (i === pageIndex) return;
      const rf = rightFields.get(el);
      if (rf) {
        model.pages[i].right = rf.getHtml();
        rf.destroy();
        rightFields.delete(el);
      }
      fillStaticRight(host, el, model.pages[i]?.right || '');
    });
    const target = pageEls[pageIndex];
    if (!target) return;
    let field = rightFields.get(target);
    if (!field) field = mountLiveRight(target, pageIndex);
    activeRightPageIndex = pageIndex;
    notifyFocus(pageIndex);
    if (!field) return;

    let index = opts.localOffset;
    if (index == null && opts.clientX != null && opts.clientY != null) {
      index = quillIndexFromClientPoint(field.quill, opts.clientX, opts.clientY);
    }
    // Always focus on activate so switching pages is one click, not two.
    try { field.quill.root.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    const max = Math.max(0, field.quill.getLength() - 1);
    if (index == null) {
      const sel = field.quill.getSelection();
      if (sel) return;
      index = 0;
    }
    field.quill.setSelection(Math.min(Math.max(0, index), max), 0, 'api');
  }

  function refreshHeaderBlockH(pageIndex = 0) {
    const p = model.pages[pageIndex] || model.pages.find((p) => p.hasHeader);
    const h = p?.header || emptyHeader();
    cachedHeaderBlockH = measureHeaderHeightPx(h);
    return cachedHeaderBlockH;
  }

  function refreshTitlesRowH(pageEl, pageIndex = 0) {
    const titlesRow = pageEl?.querySelector?.('.diary-titles-row');
    if (titlesRow && !titlesRow.hidden) {
      cachedTitlesRowH = Math.max(
        TITLES_ROW_H_PX,
        Math.ceil(titlesRow.getBoundingClientRect().height),
      );
    } else {
      const p = model.pages[pageIndex] || model.pages.find((p) => p.hasHeader);
      const invRecord = p?.header?.investigation_record || '';
      cachedTitlesRowH = measureTitlesRowHeightPx(invRecord);
    }
    return cachedTitlesRowH;
  }

  /** @param {HTMLElement} el */
  function isFlowField(el) {
    return el?.classList?.contains('diary-dotted-flow');
  }

  /** @param {HTMLElement} el */
  function getHeaderFieldValue(el) {
    if (!el) return '';
    if (isFlowField(el) || el.isContentEditable) {
      return (el.textContent || '').replace(/\u00a0/g, ' ');
    }
    return el.value || '';
  }

  /** @param {HTMLElement} el @param {string} value */
  function setHeaderFieldValue(el, value) {
    if (!el) return;
    if (isFlowField(el) || el.isContentEditable) {
      el.textContent = value || '';
    } else {
      el.value = value || '';
    }
  }

  function syncHeaderInputs(sourceEl, pageIndex) {
    const field = sourceEl.dataset.field;
    if (!HEADER_FIELDS.includes(field)) return;
    const value = getHeaderFieldValue(sourceEl);
    if (model.pages[pageIndex] && model.pages[pageIndex].header) {
      model.pages[pageIndex].header[field] = value;
    }
  }

  function readModelFromDom() {
    container.querySelectorAll('.diary-page').forEach((pageEl, i) => {
      if (!model.pages[i]) return;
      model.pages[i].hasHeader = pageEl.dataset.hasHeader === 'true';
      if (model.pages[i].hasHeader) {
        if (!model.pages[i].header) model.pages[i].header = emptyHeader();
        HEADER_FIELDS.forEach((k) => {
          const el = pageEl.querySelector(`[data-field="${k}"]`);
          if (el) model.pages[i].header[k] = getHeaderFieldValue(el);
        });
      }
      const left = pageEl.querySelector('[data-col="left"]');
      const rightHost = pageEl.querySelector('[data-col="right"]');
      if (left) model.pages[i].left = left.value;
      const rf = rightHost ? rightFields.get(pageEl) : null;
      if (rf) model.pages[i].right = rf.getHtml();
      else if (rightHost?.dataset?.staticRight === '1') {
        const ed = rightHost.querySelector('.ql-editor');
        model.pages[i].right = ed ? ed.innerHTML : (model.pages[i].right || '');
      } else if (rightHost?.value != null) model.pages[i].right = rightHost.value;
    });
  }

  function applyBoxHeights(pageEl, hasHeader) {
    const headerH = hasHeader ? cachedHeaderBlockH : HEADER_BLOCK_H_PX;
    const titlesH = hasHeader ? cachedTitlesRowH : TITLES_ROW_H_PX;
    const h = boxHeightPx(hasHeader, headerH, titlesH)
      + cellPadBottomPx(hasHeader, headerH, titlesH);
    pageEl.style.setProperty('--diary-box-h', `${h}px`);
    pageEl.querySelectorAll('.diary-cell').forEach((cell) => {
      cell.style.height = `${h}px`;
    });
    pageEl.querySelectorAll('[data-col]').forEach((ta) => {
      ta.style.height = '';
    });
  }

  function onHeaderGeometryChange(pageEl, pageIndex) {
    refreshHeaderBlockH(pageIndex);
    refreshTitlesRowH(pageEl, pageIndex);
    if (model.pages[pageIndex]?.hasHeader) {
      applyBoxHeights(pageEl, true);
      checkOverflow(pageEl, pageIndex);
    }
  }

  /**
   * Caret-space length of one page's column, measured from the live field when
   * it is mounted so it matches the editor's own offsets exactly.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @returns {number}
   */
  function caretPageLength(pageIndex, col) {
    const pageEl = container.querySelectorAll('.diary-page')[pageIndex];
    if (pageEl) {
      if (col === 'left') {
        const ta = pageEl.querySelector('[data-col="left"]');
        if (ta instanceof HTMLTextAreaElement) return ta.value.length;
      } else {
        const rf = rightFields.get(pageEl);
        if (rf) return Math.max(0, rf.quill.getLength() - 1);
      }
    }
    return caretColumnLength(model.pages[pageIndex]?.[col], col);
  }

  /**
   * @param {'left'|'right'} col
   * @returns {number[]}
   */
  function caretPageLengths(col) {
    return model.pages.map((_, i) => caretPageLength(i, col));
  }

  /**
   * @param {'left'|'right'} col
   * @param {number} pageIndex
   * @returns {number}
   */
  function globalOffsetBeforePage(col, pageIndex) {
    return caretToGlobal(caretPageLengths(col), caretJunctionCost(col), pageIndex, 0);
  }

  /**
   * @param {'left'|'right'} col
   * @returns {{ pageIndex: number, localOffset: number, global: number } | null}
   */
  /**
   * Last caret position actually observed, per column.
   *
   * Quill reports no selection at moments when it is nonetheless focused —
   * during a mousedown on other chrome, between a remount and its first
   * selection sync. Treating that as "end of document" is what silently
   * teleports the user to the bottom of the page, so the last real reading
   * stands in instead.
   * @type {{ col: 'left'|'right', read: { pageIndex: number, localOffset: number, global: number } } | null}
   */
  let lastKnownCaret = null;

  function readCaretGlobal(col) {
    const pageEls = container.querySelectorAll('.diary-page');
    for (let i = 0; i < pageEls.length; i++) {
      if (col === 'left') {
        const ta = pageEls[i].querySelector('[data-col="left"]');
        if (ta instanceof HTMLTextAreaElement && document.activeElement === ta) {
          const local = ta.selectionStart ?? ta.value.length;
          const read = {
            pageIndex: i,
            localOffset: local,
            global: globalOffsetBeforePage(col, i) + local,
          };
          lastKnownCaret = { col, read };
          return read;
        }
      } else {
        const rf = rightFields.get(pageEls[i]);
        if (rf && (document.activeElement === rf.quill.root || rf.quill.hasFocus?.())) {
          const range = rf.quill.getSelection();
          if (!range) {
            // Unknown, not "the end" — see lastKnownCaret.
            return lastKnownCaret?.col === col ? lastKnownCaret.read : null;
          }
          const read = {
            pageIndex: i,
            localOffset: range.index,
            global: globalOffsetBeforePage(col, i) + range.index,
          };
          lastKnownCaret = { col, read };
          return read;
        }
      }
    }
    return null;
  }

  /**
   * Restore caret after reflow. Do not scroll the stage — caret placement must
   * not jump the page; the user scrolls explicitly.
   * @param {'left'|'right'} col
   * @param {number} globalOffset
   */
  function restoreCaretGlobal(col, globalOffset) {
    const pageEls = container.querySelectorAll('.diary-page');
    if (!pageEls.length) return;
    const { pageIndex, localOffset: local } = caretFromGlobal(
      caretPageLengths(col),
      caretJunctionCost(col),
      globalOffset,
    );
    const pageEl = pageEls[pageIndex];
    if (!pageEl) return;
    asCaretRestore(() => {
      notifyFocus(pageIndex);
      if (col === 'left') {
        const ta = pageEl.querySelector('[data-col="left"]');
        if (ta instanceof HTMLTextAreaElement) {
          ta.focus({ preventScroll: true });
          const pos = Math.min(local, ta.value.length);
          try { ta.setSelectionRange(pos, pos); } catch (_) { /* ignore */ }
        }
      } else {
        activateRightPage(pageIndex, { localOffset: local });
      }
    });
  }

  function collapseTrailing(keepIndex = 0) {
    const before = model.pages.length;
    model.pages = collapseTrailingEmptyPages(model.pages, keepIndex);
    return model.pages.length !== before;
  }

  /**
   * Push model column text into live fields. Full render only if page count changed.
   * @param {'left'|'right'} col
   * @param {number} prevPageCount
   * @param {number | null} globalOffset
   */
  function applyColumnAfterReflow(col, prevPageCount, globalOffset) {
    const scrollSnap = snapshotStageScroll();
    let keepIndex = 0;
    if (globalOffset != null) {
      // Use model lengths, not live Quill — after spill the DOM still holds the
      // pre-cut text, so live lengths would map the caret onto page 0 and
      // collapse would drop the caret-owned blank page.
      const modelLengths = model.pages.map((p) => caretColumnLength(p?.[col], col));
      const { pageIndex } = caretFromGlobal(
        modelLengths,
        caretJunctionCost(col),
        globalOffset,
      );
      keepIndex = pageIndex;
    }
    const collapsed = collapseTrailing(keepIndex);
    const needFull = collapsed || model.pages.length !== prevPageCount
      || container.querySelectorAll('.diary-page').length !== model.pages.length;

    if (needFull) {
      render({ skipRead: true });
      restoreStageScroll(scrollSnap);
      const restore = ownedCaretRestore(() => {
        if (globalOffset != null) restoreCaretGlobal(col, globalOffset);
        else notifyFocus(Math.min(focusedPage, model.pages.length - 1));
      });
      requestAnimationFrame(() => {
        restore();
        restoreStageScroll(scrollSnap);
      });
      return;
    }

    const pageEls = container.querySelectorAll('.diary-page');
    pageEls.forEach((pageEl, i) => {
      const page = model.pages[i];
      if (!page) return;
      if (col === 'left') {
        const ta = pageEl.querySelector('[data-col="left"]');
        if (ta instanceof HTMLTextAreaElement && ta.value !== (page.left || '')) {
          ta.value = page.left || '';
        }
      } else {
        const rf = rightFields.get(pageEl);
        const host = pageEl.querySelector('[data-col="right"]');
        if (rf) {
          const next = page.right || '';
          if (rf.getHtml() !== next) {
            rf.setContent(next);
          }
        } else if (host instanceof HTMLElement && host.dataset.staticRight === '1') {
          fillStaticRight(host, pageEl, page.right || '');
        }
      }
    });

    restoreStageScroll(scrollSnap);
    const restore = ownedCaretRestore(() => {
      if (globalOffset != null) restoreCaretGlobal(col, globalOffset);
    });
    requestAnimationFrame(() => {
      restore();
      restoreStageScroll(scrollSnap);
    });
  }

  /**
   * Cascade overflowing text from pageIndex's column onto following pages.
   * @param {number} pageIndex
   * @param {'left'|'right'|string} col
   * @param {{ globalOffset?: number | null }} [opts]
   */
  function spillColumn(pageIndex, col, opts = {}) {
    if (spilling) return false;
    if (col !== 'left' && col !== 'right') return false;
    if (!model.pages[pageIndex]) return false;

    spilling = true;
    const fromPage = pageIndex;
    const prevPageCount = model.pages.length;
    const caret = opts.globalOffset != null ? { global: opts.globalOffset } : readCaretGlobal(col);
    const globalOffset = caret?.global ?? null;
    let i = pageIndex;
    let didSpill = false;
    let iterations = 0;
    const headerH = cachedHeaderBlockH;
    const titlesH = cachedTitlesRowH;

    while (i < model.pages.length && iterations++ < 50) {
      const text = model.pages[i][col] || '';
      const pageHasHeader = model.pages[i].hasHeader;
      let keep;
      let spill;
      const pageElLive = container.querySelectorAll('.diary-page')[i];
      if (col === 'left' && pageElLive) {
        const ta = pageElLive.querySelector('[data-col="left"]');
        if (ta instanceof HTMLTextAreaElement) {
          const prevVal = ta.value;
          ta.value = text;
          ({ keep, spill } = splitOverflow(ta));
          ta.value = prevVal;
        } else {
          ({ keep, spill } = splitTextToFit(
            text,
            col,
            pageHasHeader,
            pageHasHeader ? headerH : HEADER_BLOCK_H_PX,
            pageHasHeader ? titlesH : TITLES_ROW_H_PX,
          ));
        }
      } else {
        ({ keep, spill } = splitTextToFit(
          text,
          col,
          pageHasHeader,
          pageHasHeader ? headerH : HEADER_BLOCK_H_PX,
          pageHasHeader ? titlesH : TITLES_ROW_H_PX,
          liveBoxFor(i, col) || {},
        ));
      }

      // Live peel: static/probe cut can leave one line too many in the real box.
      ({ keep, spill } = peelUntilLiveFits(i, col, keep, spill));

      if (!spill) {
        // Still overflowing with empty spill — peel at least one unit forward.
        if (contentOverflowsPage(i, col, keep || text)) {
          const peeled = peelLastContentUnit(keep || text);
          if (peeled.peeled) {
            keep = peeled.keep;
            // Same merge as peelUntilLiveFits — avoid one-word <p> blocks.
            spill = col === 'right'
              ? prependPeeledBlock(peeled.peeled, '')
              : peeled.peeled;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      didSpill = true;
      model.pages[i][col] = keep;
      if (i + 1 >= model.pages.length) {
        model.pages.push({ hasHeader: false, left: '', right: '' });
      }
      const existing = model.pages[i + 1][col] || '';
      model.pages[i + 1][col] = col === 'right'
        ? joinRightSpillOntoNext(spill, existing)
        : joinColumnContent(spill, existing);
      i += 1;
    }

    if (didSpill) {
      applyColumnAfterReflow(col, prevPageCount, globalOffset);
      notify();
      hooks.onSpill?.({
        fromPage: fromPage + 1,
        toPage: i + 1,
        col,
      });
      requestAnimationFrame(() => {
        if (spilling) return;
        const pageEls = container.querySelectorAll('.diary-page');
        for (let pi = 0; pi < pageEls.length; pi++) {
          if (columnOverflows(pageEls[pi], col)) {
            // A frame has passed and this page's caret was already restored;
            // reuse where it actually is, not the offset from before the spill.
            spillColumn(pi, col, { globalOffset: freshCaretGlobal(col, globalOffset) });
            return;
          }
        }
      });
    }

    spilling = false;
    return didSpill;
  }

  /**
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {string} content
   * @returns {boolean}
   */
  function contentOverflowsPage(pageIndex, col, content) {
    const pageEl = container.querySelectorAll('.diary-page')[pageIndex];
    if (col === 'left') {
      const ta = pageEl?.querySelector?.('[data-col="left"]');
      if (!(ta instanceof HTMLTextAreaElement) || !ta.clientHeight) {
        const box = liveBoxFor(pageIndex, col);
        if (!box) return false;
        const probe = document.createElement('textarea');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = [
          'position:absolute',
          'left:-99999px',
          'top:0',
          'visibility:hidden',
          `width:${box.boxWidth}px`,
          `height:${box.boxHeight}px`,
          'box-sizing:border-box',
          `font-size:${FONT_PX}px`,
          `line-height:${LINE_HEIGHT_PX}px`,
          'padding:4px 6px',
          'border:none',
          'margin:0',
          'white-space:pre-wrap',
          'overflow:hidden',
        ].join(';');
        probe.value = content;
        document.body.appendChild(probe);
        const bad = probe.scrollHeight > probe.clientHeight + 1;
        probe.remove();
        return bad;
      }
      const probe = document.createElement('textarea');
      probe.setAttribute('aria-hidden', 'true');
      const cs = getComputedStyle(ta);
      probe.style.cssText = [
        'position:absolute',
        'left:-99999px',
        'top:0',
        'visibility:hidden',
        `width:${ta.clientWidth}px`,
        `height:${ta.clientHeight}px`,
        'box-sizing:border-box',
        `font:${cs.font}`,
        `font-size:${cs.fontSize}`,
        `line-height:${cs.lineHeight}`,
        `padding:${cs.padding}`,
        `letter-spacing:${cs.letterSpacing}`,
        `white-space:${cs.whiteSpace}`,
        'border:none',
        'margin:0',
        'overflow:hidden',
      ].join(';');
      probe.value = content;
      document.body.appendChild(probe);
      const bad = probe.scrollHeight > probe.clientHeight + 1;
      probe.remove();
      return bad;
    }
    if (!pageEl) {
      const box = liveBoxFor(pageIndex, col);
      if (!box) return false;
      return !measureRichFits(content, box.boxWidth, box.boxHeight, {
        styleSource: box.styleSource || null,
      });
    }
    const rf = rightFields.get(pageEl);
    if (rf) {
      const prev = rf.getHtml();
      rf.setContent(content);
      rf.quill.root.scrollTop = 0;
      const bad = !rf.fitsInBox();
      rf.setContent(prev);
      return bad;
    }
    const editor = pageEl.querySelector('[data-col="right"] .ql-editor');
    const box = liveBoxFor(pageIndex, col);
    if (box) {
      return !measureRichFits(content, box.boxWidth, box.boxHeight, {
        styleSource: box.styleSource || editor || null,
      });
    }
    return false;
  }

  /**
   * After a probe cut, peel trailing units until the live box accepts `keep`.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {string} keep
   * @param {string} spill
   * @returns {{ keep: string, spill: string }}
   */
  function peelUntilLiveFits(pageIndex, col, keep, spill) {
    let k = String(keep ?? '');
    let s = String(spill ?? '');
    let guard = 0;
    while (guard++ < 80 && k && contentOverflowsPage(pageIndex, col, k)) {
      const { keep: nextKeep, peeled } = peelLastContentUnit(k);
      if (!peeled) break;
      k = nextKeep;
      // Right column: merge peeled word into spill's first matching paragraph
      // so aligned peels do not become one <p> per word. Left stays plain join.
      s = col === 'right' ? prependPeeledBlock(peeled, s) : joinColumnContent(peeled, s);
    }
    return { keep: k, spill: s };
  }

  /**
   * Dimensions of a live column box, so the offscreen split fits against the
   * same space the page actually gives. The computed geometry can be a few px
   * off from CSS, which is enough to leave a line clipped with no page break.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @returns {{ boxWidth: number, boxHeight: number, styleSource?: HTMLElement } | null}
   */
  function liveBoxFor(pageIndex, col) {
    const pageEl = container.querySelectorAll('.diary-page')[pageIndex];
    if (!pageEl) return null;
    const el = col === 'left'
      ? pageEl.querySelector('[data-col="left"]')
      : (rightFields.get(pageEl)?.quill?.root
        || pageEl.querySelector('[data-col="right"] .ql-editor'));
    if (!(el instanceof HTMLElement) || !el.clientHeight || !el.clientWidth) return null;
    return {
      boxWidth: el.clientWidth,
      boxHeight: el.clientHeight,
      styleSource: col === 'right' ? el : undefined,
    };
  }

  /**
   * Whether a live column box is taller than the space it has.
   * @param {Element} pageEl
   * @param {'left'|'right'} col
   * @returns {boolean}
   */
  function columnOverflows(pageEl, col) {
    if (col === 'left') {
      const ta = pageEl.querySelector('[data-col="left"]');
      return ta instanceof HTMLTextAreaElement
        && (ta.scrollHeight > ta.clientHeight + 1 || ta.scrollTop > 0);
    }
    const rf = rightFields.get(pageEl);
    if (rf) {
      if (rf.quill.root.scrollTop > 0) return true;
      return !rf.fitsInBox();
    }
    const editor = pageEl.querySelector('[data-col="right"] .ql-editor');
    if (!(editor instanceof HTMLElement)) return false;
    if (editor.scrollTop > 0) return true;
    return editor.scrollHeight > editor.clientHeight + 1;
  }

  /**
   * After Quill DOM mutations, scrollHeight can lag one or two frames. Recheck
   * every page so Enter-after-absorb cannot leave a clipped box with no spill.
   * @param {'left'|'right'} col
   * @param {number | null} globalOffset
   */
  function scheduleOverflowRecheck(col, globalOffset) {
    const epoch = reflowEpoch;
    const run = () => {
      if (epoch !== reflowEpoch) return;
      if (spilling || history.applying) return;
      const pageEls = container.querySelectorAll('.diary-page');
      for (let i = 0; i < pageEls.length; i++) {
        if (columnOverflows(pageEls[i], col)) {
          // Two frames late: the caret has been restored (and possibly refined
          // by an absorb snap) since `globalOffset` was captured. Replaying the
          // captured value here would undo that refinement.
          spillColumn(i, col, { globalOffset: freshCaretGlobal(col, globalOffset) });
          settleHistory();
          return;
        }
      }
      settleHistory();
    };
    // Two frames: Quill often commits the Enter line box only after paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  }

  /**
   * Pull one content unit at a time from laterIndex into laterIndex-1 while it fits.
   * Right column may pull a fitting text prefix of an overflowing paragraph.
   * @param {number} laterIndex
   * @param {'left'|'right'} col
   * @returns {boolean}
   */
  function absorbIntoPrev(laterIndex, col) {
    if (laterIndex <= 0 || !model.pages[laterIndex] || !model.pages[laterIndex - 1]) {
      return false;
    }
    let moved = false;
    let guard = 0;
    while (guard++ < 200) {
      const later = model.pages[laterIndex][col] || '';
      if (!later) break;
      const prev = model.pages[laterIndex - 1][col] || '';
      const { unit: whole, rest: afterWhole } = takeFirstContentUnit(later);
      if (!whole) break;
      const combinedWhole = joinColumnContent(prev, whole);
      if (!contentOverflowsPage(laterIndex - 1, col, combinedWhole)) {
        model.pages[laterIndex - 1][col] = combinedWhole;
        model.pages[laterIndex][col] = afterWhole;
        moved = true;
        continue;
      }
      // Whole unit does not fit. Left stays line-based; right may take a prefix
      // (merged into the last paragraph when that fills leftover line width).
      if (col !== 'right') break;
      const box = liveBoxFor(laterIndex - 1, col);
      if (!box) break;
      const { nextPrev, rest } = takeFittingHtmlPrefix(
        prev,
        later,
        box.boxWidth,
        box.boxHeight,
        { styleSource: box.styleSource || null },
      );
      if (nextPrev === prev) break;
      if (contentOverflowsPage(laterIndex - 1, col, nextPrev)) break;
      model.pages[laterIndex - 1][col] = nextPrev;
      model.pages[laterIndex][col] = rest;
      moved = true;
    }
    return moved;
  }

  /**
   * Pull content into slack around pageIndex (prev<-this and this<-next).
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {{ globalOffset?: number | null }} [opts]
   */
  function absorbAround(pageIndex, col, opts = {}) {
    if (spilling) return false;
    if (col !== 'left' && col !== 'right') return false;

    spilling = true;
    const prevPageCount = model.pages.length;
    const caret = opts.globalOffset != null ? { global: opts.globalOffset } : readCaretGlobal(col);
    const globalOffset = caret?.global ?? null;
    let didAbsorb = false;

    if (pageIndex > 0) {
      didAbsorb = absorbIntoPrev(pageIndex, col) || didAbsorb;
    }
    if (pageIndex + 1 < model.pages.length) {
      didAbsorb = absorbIntoPrev(pageIndex + 1, col) || didAbsorb;
    }
    // Cascade: earlier pages may have gained slack after pulls.
    for (let i = 1; i < model.pages.length; i++) {
      didAbsorb = absorbIntoPrev(i, col) || didAbsorb;
    }

    if (didAbsorb) {
      applyColumnAfterReflow(col, prevPageCount, globalOffset);
      notify();
      // Absorb can overshoot live height vs probe; spill any clip after paint.
      scheduleOverflowRecheck(col, globalOffset);
    }

    spilling = false;
    return didAbsorb;
  }

  /**
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {{ globalOffset?: number | null }} [opts]
   */
  function reflowColumn(pageIndex, col, opts = {}) {
    if (spilling || history.applying) return;
    const globalOffset = opts.globalOffset != null
      ? opts.globalOffset
      : (readCaretGlobal(col)?.global ?? null);
    const pageEl = container.querySelectorAll('.diary-page')[pageIndex];
    // Flush layout so scrollHeight reflects the edit that just mutated Quill.
    if (pageEl instanceof HTMLElement) void pageEl.offsetHeight;
    const overflowing = Boolean(pageEl) && columnOverflows(pageEl, col);

    if (overflowing) {
      spillColumn(pageIndex, col, { globalOffset });
    } else {
      absorbAround(pageIndex, col, { globalOffset });
    }
    // Always recheck next frames — Enter after absorb/spill can report a
    // still-fitting height synchronously and only overflow after paint.
    scheduleOverflowRecheck(col, globalOffset);
    settleHistory();
  }

  /**
   * True while Hinglish suggestions own the current word — reflow would fight
   * the pending replace.
   * @returns {boolean}
   */
  function translitOwnsInput() {
    const box = document.getElementById('suggestions');
    if (!(box instanceof HTMLElement)) return false;
    if (box.style.display === 'none' || box.hidden) return false;
    return box.childElementCount > 0;
  }

  /**
   * Large clipboard/paste inserts must always reflow even if the suggestions
   * box is open — otherwise the page stays overfull and ArrowDown scrolls
   * the fixed `.ql-editor` (scrollTop > 0 → clipped from the top).
   * @param {{ ops?: object[] } | null | undefined} delta
   * @returns {boolean}
   */
  function isLargeUserInsert(delta) {
    let n = 0;
    for (const op of delta?.ops || []) {
      if (typeof op.insert === 'string') n += op.insert.length;
      else if (op.insert != null) n += 1;
    }
    return n >= 40;
  }

  /**
   * Diary boxes must never scroll — overflow means spill failed.
   * @param {object} field
   * @param {number} pageIndex
   */
  function clampRightScrollAndReflow(field, pageIndex) {
    if (!field?.quill?.root || spilling || history.applying) return;
    const root = field.quill.root;
    if (root.scrollTop !== 0) root.scrollTop = 0;
    if (!field.fitsInBox() || root.scrollTop > 0) {
      root.scrollTop = 0;
      model.pages[pageIndex].right = field.getHtml();
      const local = field.quill.getSelection()?.index
        ?? Math.max(0, field.quill.getLength() - 1);
      const globalOffset = globalOffsetBeforePage('right', pageIndex) + local;
      reflowColumn(pageIndex, 'right', { globalOffset });
    }
  }

  /**
   * @param {number} pageIndex
   * @param {object} field
   * @param {object} [meta]
   */
  function reflowRightAfterEdit(pageIndex, field, meta) {
    if (spilling || history.applying) return;
    const largePaste = isLargeUserInsert(meta?.delta);
    if (field.quill.root.isComposing || (!largePaste && translitOwnsInput())) return;
    const local = caretIndexAfterTextChange(field.quill, meta?.delta);
    const globalOffset = globalOffsetBeforePage('right', pageIndex) + local;
    reflowColumn(pageIndex, 'right', { globalOffset });
    // Paste/layout can leave scrollTop mid-frame; pin it after paint.
    requestAnimationFrame(() => {
      if (field?.quill?.root) field.quill.root.scrollTop = 0;
    });
    if (!spilling) notify();
  }

  function checkOverflow(pageEl, pageIndex) {
    if (spilling || history.applying) return;
    const left = pageEl.querySelector('[data-col="left"]');
    if (left instanceof HTMLTextAreaElement) {
      left.classList.remove('diary-box-overflow');
      left.closest('.diary-cell')?.classList.remove('diary-box-overflow');
      if (left.scrollHeight > left.clientHeight + 1) {
        spillColumn(pageIndex, 'left');
      }
    }
    const rf = rightFields.get(pageEl);
    if (rf) {
      rf.quill.root.classList.remove('diary-box-overflow');
      pageEl.querySelector('[data-col="right"]')?.closest('.diary-cell')
        ?.classList.remove('diary-box-overflow');
      if (!rf.fitsInBox()) {
        spillColumn(pageIndex, 'right');
      }
    } else if (columnOverflows(pageEl, 'right')) {
      spillColumn(pageIndex, 'right');
    }
  }

  /**
   * Plain text at the start of a page column (for caret snap after absorb).
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {number} [n]
   * @returns {string}
   */
  function peekColumnAhead(pageIndex, col, n = 32) {
    const pageEl = container.querySelectorAll('.diary-page')[pageIndex];
    if (col === 'left') {
      const ta = pageEl?.querySelector('[data-col="left"]');
      const v = ta instanceof HTMLTextAreaElement
        ? ta.value
        : String(model.pages[pageIndex]?.left || '');
      return v.slice(0, n);
    }
    const rf = pageEl ? rightFields.get(pageEl) : null;
    if (rf) return rf.quill.getText().slice(0, n);
    const plain = stripHtmlToPlain(model.pages[pageIndex]?.right || '');
    return plain.slice(0, n);
  }

  /**
   * Place caret before `ahead` on destPage, searching from minLocal so earlier
   * duplicate phrases on the page are skipped (common with Hindi filler).
   * @param {'left'|'right'} col
   * @param {number} destPageIndex
   * @param {number} minLocal
   * @param {string} ahead
   * @returns {boolean}
   */
  function restoreCaretAtAhead(col, destPageIndex, minLocal, ahead) {
    return asCaretRestore(() => restoreCaretAtAheadInner(col, destPageIndex, minLocal, ahead));
  }

  /**
   * @param {'left'|'right'} col
   * @param {number} destPageIndex
   * @param {number} minLocal
   * @param {string} ahead
   * @returns {boolean}
   */
  function restoreCaretAtAheadInner(col, destPageIndex, minLocal, ahead) {
    if (!ahead) return false;
    const pageEl = container.querySelectorAll('.diary-page')[destPageIndex];
    if (!pageEl) return false;
    if (col === 'left') {
      const ta = pageEl.querySelector('[data-col="left"]');
      if (!(ta instanceof HTMLTextAreaElement)) return false;
      const from = Math.max(0, Math.min(minLocal, ta.value.length));
      let at = ta.value.indexOf(ahead, from);
      if (at < 0) at = ta.value.indexOf(ahead);
      if (at < 0) return false;
      notifyFocus(destPageIndex);
      ta.focus({ preventScroll: true });
      try { ta.setSelectionRange(at, at); } catch (_) { /* ignore */ }
      return true;
    }
    activateRightPage(destPageIndex);
    const rf = rightFields.get(pageEl);
    if (!rf) return false;
    const text = rf.quill.getText();
    const from = Math.max(0, Math.min(minLocal, text.length));
    let at = text.indexOf(ahead, from);
    if (at < 0) at = text.indexOf(ahead);
    if (at < 0) return false;
    const max = Math.max(0, rf.quill.getLength() - 1);
    try { rf.quill.root.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    rf.quill.setSelection(Math.min(at, max), 0, 'api');
    return true;
  }

  /**
   * Backspace at start of page N: absorb into prev when slack exists; otherwise
   * delete last char of previous page, then absorb.
   * @param {number} pageIndex
   * @param {'left'|'right'} col
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  function handleBoundaryBackspace(pageIndex, col, e) {
    if (pageIndex <= 0 || spilling || history.applying) return false;
    const prev = model.pages[pageIndex - 1];
    if (!prev) return false;

    e.preventDefault();
    e.stopPropagation();

    lastCaretCol = col;
    markUserEdit({ force: true });

    const junction = caretJunctionCost(col);
    const globalAtJunction = globalOffsetBeforePage(col, pageIndex);
    const prevLen = caretPageLength(pageIndex - 1, col);
    if (prevLen === 0) {
      restoreCaretGlobal(col, Math.max(0, globalAtJunction - 1));
      return true;
    }

    // Enter-spill blank page: drop it and land at end of prev (do not eat prev's last char).
    const curPage = model.pages[pageIndex];
    const curLen = caretPageLength(pageIndex, col);
    if (curLen === 0 || isPageBodyEmpty(curPage)) {
      const prevPageCount = model.pages.length;
      model.pages.splice(pageIndex, 1);
      const caretAtPrevEnd = Math.max(0, globalAtJunction - junction);
      applyColumnAfterReflow(col, prevPageCount, caretAtPrevEnd);
      notify();
      return true;
    }

    // Text that followed the caret — after absorb it must still sit under the caret
    // (merge into last paragraph has no inter-page junction, so globalAtJunction
    // alone is one index too far and lands inside a Devanagari cluster).
    const ahead = peekColumnAhead(pageIndex, col);
    const absorbCaretGlobal = Math.max(0, globalAtJunction - junction);

    // Absorb-first: pull into slack without deleting.
    const absorbedFirst = absorbAround(pageIndex, col, { globalOffset: absorbCaretGlobal });
    if (absorbedFirst) {
      // Snap to the pulled text at/after the old end of prev (skip duplicates).
      requestAnimationFrame(ownedCaretRestore(() => {
        if (!restoreCaretAtAhead(col, pageIndex - 1, prevLen, ahead)) {
          restoreCaretGlobal(col, absorbCaretGlobal);
        }
      }));
      return true;
    }

    const globalAfter = globalAtJunction - 1;
    spilling = true;
    const prevPageCount = model.pages.length;

    if (col === 'left') {
      prev.left = String(prev.left || '').slice(0, -1);
    } else {
      // Prev page may be static HTML under continuous-right — activate it so
      // we delete the last Quill character, not a plain-text round-trip.
      const pageEls = container.querySelectorAll('.diary-page');
      activateRightPage(pageIndex - 1);
      const rf = rightFields.get(pageEls[pageIndex - 1]);
      if (rf) {
        const len = Math.max(0, rf.quill.getLength() - 1);
        if (len > 0) rf.quill.deleteText(len - 1, 1, 'silent');
        prev.right = rf.getHtml();
      } else {
        const plain = stripHtmlToPlain(prev.right || '');
        prev.right = plain.slice(0, -1);
      }
    }
    spilling = false;

    const absorbed = absorbAround(pageIndex, col, { globalOffset: globalAfter });
    if (!absorbed) {
      applyColumnAfterReflow(col, prevPageCount, globalAfter);
      notify();
    }
    return true;
  }

  function wirePage(pageEl, pageIndex) {
    applyBoxHeights(pageEl, model.pages[pageIndex].hasHeader);

    pageEl.querySelectorAll(
      'input[data-field], textarea[data-field], textarea[data-col], [data-field].diary-dotted-flow',
    ).forEach((el) => {
      hooks.onAttachField?.(el);
    });

    const rightHost = pageEl.querySelector('[data-col="right"]');
    if (rightHost && !(rightHost instanceof HTMLTextAreaElement)) {
      if (pageIndex === activeRightPageIndex || pageIndex === focusedPage) {
        activeRightPageIndex = pageIndex;
        mountLiveRight(pageEl, pageIndex);
      } else {
        fillStaticRight(rightHost, pageEl, model.pages[pageIndex].right || '');
      }
      rightHost.addEventListener('mousedown', (e) => {
        if (rightHost.dataset.staticRight !== '1') return;
        if (e.button !== 0) return;
        // Static DOM is replaced on activate — preventDefault so focus/caret
        // are applied on the new Quill in this same gesture (one click).
        e.preventDefault();
        noteUserCaret();
        activateRightPage(pageIndex, { clientX: e.clientX, clientY: e.clientY });
      });
    }

    pageEl.querySelectorAll('input[data-field], textarea[data-field]').forEach((el) => {
      el.addEventListener('input', () => {
        markUserEdit();
        syncHeaderInputs(el, pageIndex);
        notify();
        settleHistory();
      });
      el.addEventListener('change', () => {
        markUserEdit({ force: true });
        syncHeaderInputs(el, pageIndex);
        notify();
        settleHistory();
      });
    });

    pageEl.querySelectorAll('[data-field].diary-dotted-flow').forEach((el) => {
      el.addEventListener('input', () => {
        markUserEdit();
        syncHeaderInputs(el, pageIndex);
        onHeaderGeometryChange(pageEl, pageIndex);
        notify();
        settleHistory();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      });
      el.addEventListener('blur', () => {
        if (!(el.textContent || '').trim()) {
          el.textContent = '';
        }
      });
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        markUserEdit({ force: true });
        const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
        const clean = text.replace(/\r?\n+/g, ' ');
        if (document.queryCommandSupported?.('insertText')) {
          document.execCommand('insertText', false, clean);
        } else {
          const sel = window.getSelection();
          if (sel?.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(clean));
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        syncHeaderInputs(el, pageIndex);
        onHeaderGeometryChange(pageEl, pageIndex);
        notify();
        settleHistory();
      });
    });

    pageEl.querySelectorAll('textarea[data-col]').forEach((ta) => {
      const col = /** @type {'left'|'right'} */ (ta.dataset.col);
      const runOverflow = () => {
        lastCaretCol = col;
        model.pages[pageIndex][col] = ta.value;
        reflowColumn(pageIndex, col);
        if (!spilling) notify();
      };
      ta.addEventListener('input', () => {
        markUserEdit();
        runOverflow();
      });
      ta.addEventListener('paste', () => {
        markUserEdit({ force: true });
        requestAnimationFrame(runOverflow);
      });
      ta.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key.startsWith('Arrow') && !e.shiftKey) {
          crossPageOnArrow(pageIndex, col, e.key);
          return;
        }
        if (ta.selectionStart !== ta.selectionEnd) return;

        if (e.key === 'Delete' && ta.selectionStart === ta.value.length) {
          handleBoundaryDelete(pageIndex, col, e);
          return;
        }
        if (e.key !== 'Backspace' || ta.selectionStart !== 0) return;
        handleBoundaryBackspace(pageIndex, col, e);
      });
      // `noteUserCaret` no-ops while we are restoring, so our own ta.focus()
      // does not read as the user taking the caret.
      ta.addEventListener('focus', () => {
        noteUserCaret();
        notifyFocus(pageIndex);
      });
      ta.addEventListener('click', () => {
        noteUserCaret();
        notifyFocus(pageIndex);
      });
    });

    const toggle = pageEl.querySelector('.diary-header-toggle');
    if (toggle) {
      /**
       * Captured on mousedown, not click: pressing the button blurs the editor
       * first, and by click time there is no caret left to read.
       * @type {{ col: 'left'|'right', global: number } | null}
       */
      let caretBeforeToggle = null;
      toggle.addEventListener('mousedown', () => {
        caretBeforeToggle = readCaretAnyColumn();
      });

      toggle.addEventListener('click', () => {
        markUserEdit({ force: true });
        const keep = caretBeforeToggle;
        caretBeforeToggle = null;
        const nextState = !model.pages[pageIndex].hasHeader;
        model.pages[pageIndex].hasHeader = nextState;
        if (nextState && !model.pages[pageIndex].header) {
          model.pages[pageIndex].header = getPrefilledHeader(pageIndex);
        }
        render({ skipRead: true });
        // A header is roughly a fifth of the page, so this reflows everything
        // below it. Put the caret back on the text it was in rather than
        // dropping the user wherever the re-render happens to land.
        //
        // Synchronously, not on a later frame: render() has already rebuilt
        // the pages, and the reflow that follows reads the *live* caret to
        // carry it along. Restoring a frame later would let that reflow run
        // against a caret it never had, and land the user on another page.
        if (keep) {
          restoreCaretGlobal(keep.col, keep.global);
        }
        settleHistory();
        notify();
      });
    }

    const delBtn = pageEl.querySelector('.diary-page-delete');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (model.pages.length <= 1) return;
        if (!confirm('Delete this page? You can undo with Ctrl+Z.')) return;
        markUserEdit({ force: true });
        model.pages.splice(pageIndex, 1);
        render({ skipRead: true });
        settleHistory();
        notify();
      });
    }

    pageEl.addEventListener('focusin', () => notifyFocus(pageIndex));
  }

  function buildPageEl(page, pageIndex) {
    const frag = template.content.cloneNode(true);
    const pageEl = frag.querySelector('.diary-page');
    pageEl.dataset.pageIndex = String(pageIndex);
    pageEl.dataset.hasHeader = page.hasHeader ? 'true' : 'false';

    const headerBlock = pageEl.querySelector('.diary-page-header');
    const titlesRow = pageEl.querySelector('.diary-titles-row');
    if (headerBlock) headerBlock.hidden = !page.hasHeader;
    if (titlesRow) titlesRow.hidden = !page.hasHeader;

    HEADER_FIELDS.forEach((k) => {
      const el = pageEl.querySelector(`[data-field="${k}"]`);
      if (el) setHeaderFieldValue(el, page.header ? page.header[k] : '');
    });

    const left = pageEl.querySelector('[data-col="left"]');
    if (left) left.value = page.left || '';
    // Right Quill is mounted in wirePage with model content

    const toggle = pageEl.querySelector('.diary-header-toggle');
    if (toggle) {
      toggle.textContent = page.hasHeader ? 'Hide header' : 'Show header';
      toggle.setAttribute('aria-pressed', page.hasHeader ? 'true' : 'false');
      toggle.title = page.hasHeader ? 'Hide page header' : 'Show page header';
    }

    const delBtn = pageEl.querySelector('.diary-page-delete');
    if (delBtn) {
      delBtn.hidden = model.pages.length <= 1;
      delBtn.title = 'Delete this page';
      delBtn.setAttribute('aria-label', 'Delete this page');
    }

    const label = pageEl.querySelector('.diary-page-label');
    if (label) label.textContent = `Page ${pageIndex + 1}`;

    return pageEl;
  }

  function render({ skipRead = false } = {}) {
    if (!skipRead && container.querySelector('.diary-page')) {
      readModelFromDom();
    }
    container.innerHTML = '';
    container.style.setProperty('--diary-left-col', `${LEFT_COL_PCT}%`);

    model.pages.forEach((page, i) => {
      const pageEl = buildPageEl(page, i);
      container.appendChild(pageEl);
      wirePage(pageEl, i);
      applyBoxHeights(pageEl, page.hasHeader);
      if (!spilling) {
        requestAnimationFrame(() => {
          if (!pageEl.isConnected) return;
          if (page.hasHeader) {
            refreshHeaderBlockH(i);
            refreshTitlesRowH(pageEl, i);
            applyBoxHeights(pageEl, true);
          }
          checkOverflow(pageEl, i);
        });
      }
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'diary-add-page screen-only';
    addBtn.title = 'Add a new diary page';
    addBtn.setAttribute('aria-label', 'Add a new diary page');
    addBtn.innerHTML = '<i class="fas fa-plus"></i> Add page';
    addBtn.addEventListener('click', () => {
      markUserEdit({ force: true });
      addPage(false);
      settleHistory();
      notify();
    });
    container.appendChild(addBtn);

    notifyFocus(Math.min(focusedPage, model.pages.length - 1));
  }

  function getPrefilledHeader(startIndex) {
    let srcHeader = null;
    for (let i = startIndex - 1; i >= 0; i--) {
      if (model.pages[i].hasHeader && model.pages[i].header) {
        srcHeader = model.pages[i].header;
        break;
      }
    }
    if (!srcHeader) return emptyHeader();
    
    const newHeader = { ...srcHeader };
    const num = parseInt(newHeader.case_diary_no, 10);
    if (!isNaN(num)) {
      newHeader.case_diary_no = String(num + 1);
    }
    return newHeader;
  }

  function addPage(hasHeader) {
    if (container.dataset.adding === '1') return;
    container.dataset.adding = '1';
    
    let header = null;
    if (hasHeader) {
      header = getPrefilledHeader(model.pages.length);
    }
    model.pages.push({ hasHeader: Boolean(hasHeader), header, left: '', right: '' });
    render({ skipRead: true });
    container.dataset.adding = '0';
  }

  function setModel(next) {
    clearHistory();
    model = normalizeDiaryModel(next);
    focusedPage = 0;
    activeRightPageIndex = 0;
    render({ skipRead: true });
    settleHistory();
  }

  function getModel() {
    readModelFromDom();
    return {
      pages: model.pages.map((p) => ({ ...p, header: p.header ? { ...p.header } : null })),
    };
  }

  function clear() {
    setModel(emptyModel());
  }

  render();
  settleHistory();

  return {
    setModel,
    getModel,
    clear,
    render,
    undo,
    redo,
    clearHistory,
    get pageCount() { return model.pages.length; },
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
  };
}
