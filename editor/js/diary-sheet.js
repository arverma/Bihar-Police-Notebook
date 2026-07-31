/**
 * A4 paged diary sheet — geometry + page UI + print helpers.
 *
 * Margin is half the Google Docs default (0.5in / 12.7mm).
 * Box heights snap to whole 24px lines so no line splits across pages.
 */

import {
  contentToPrintHtml,
  mountQuill,
  quillPrintCssFragment,
  splitRichToFit,
  stripHtmlToPlain,
} from './quill-fields.js';

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

/**
 * Print stylesheet — screen and print share the same A4 geometry.
 */
export function diaryPrintCss() {
  return `
    @page {
      size: A4;
      margin: ${MARGIN_MM}mm;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .diary-print-page {
      width: ${CONTENT_W_MM}mm;
      height: ${CONTENT_H_MM}mm;
      box-sizing: border-box;
      font-family: 'Noto Sans Devanagari', Arial, sans-serif;
      font-size: ${FONT_PX}px;
      line-height: ${LINE_HEIGHT_PX}px;
      color: #000;
      page-break-after: always;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .diary-print-page:last-child {
      page-break-after: auto;
    }
    ${diaryHeaderPrintCssFragment()}
    .diary-print-table {
      flex: 0 0 auto;
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1.5px solid #000;
      box-sizing: border-box;
    }
    .diary-print-table th,
    .diary-print-table td {
      border: 1px solid #000;
      vertical-align: top;
      padding: 0;
      word-wrap: break-word;
    }
    .diary-print-table th.left-col,
    .diary-print-table td.left-col {
      width: ${LEFT_COL_PCT}%;
    }
    .diary-print-table th.right-col,
    .diary-print-table td.right-col {
      width: ${100 - LEFT_COL_PCT}%;
    }
    .diary-print-table th {
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      line-height: 1.3;
      min-height: ${TITLES_ROW_H_PX}px;
      height: auto;
      padding: 6px 8px;
      box-sizing: border-box;
    }
    .diary-print-body {
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      font-size: ${FONT_PX}px;
      line-height: ${LINE_HEIGHT_PX}px;
      margin: 0;
      padding: 4px 6px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .diary-print-body.ql-print {
      white-space: normal;
    }
    ${quillPrintCssFragment()}
  `;
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
 * Build print HTML from the diary model (same geometry as screen).
 */
export function diaryPagesHtml(model) {
  const m = normalizeDiaryModel(model);
  return m.pages.map((page) => {
    const h = page.hasHeader;
    const headerBlockH = h ? measureHeaderHeightPx(page.header) : HEADER_BLOCK_H_PX;
    const titlesRowH = h ? measureTitlesRowHeightPx(page.header.investigation_record) : TITLES_ROW_H_PX;
    const boxH = boxHeightPx(h, headerBlockH, titlesRowH)
      + cellPadBottomPx(h, headerBlockH, titlesRowH);
    const titles = h ? `
      <tr>
        <th class="left-col">किन तिथि को (समय सहित) कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया</th>
        <th class="right-col">
          अन्वेषण का अभिलेख
          ${page.header.investigation_record
            ? `<div>(${escapeHtml(page.header.investigation_record)})</div>`
            : ''}
        </th>
      </tr>
    ` : '';
    const headerBlock = h ? printHeaderHtml(page.header) : '';
    return `
      <div class="diary-print-page${h ? ' has-header' : ' no-header'}">
        ${headerBlock}
        <table class="diary-print-table">
          ${titles}
          <tr class="body-row">
            <td class="left-col" style="height:${boxH}px;">
              <div class="diary-print-body" style="height:${boxH}px;">${escapeHtml(page.left)}</div>
            </td>
            <td class="right-col" style="height:${boxH}px;">
              <div class="diary-print-body ql-print" style="height:${boxH}px;">${contentToPrintHtml(page.right)}</div>
            </td>
          </tr>
        </table>
      </div>
    `;
  }).join('');
}

/**
 * Spill text that overflows a fixed-height textarea at the last whitespace
 * boundary that still fits.
 */
function splitOverflow(textarea) {
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
 */
function splitTextToFit(
  text,
  col,
  hasHeader,
  headerBlockH = HEADER_BLOCK_H_PX,
  titlesRowH = TITLES_ROW_H_PX,
) {
  if (!text) return { keep: '', spill: '' };
  const boxH = boxHeightPx(hasHeader, headerBlockH, titlesRowH)
    + cellPadBottomPx(hasHeader, headerBlockH, titlesRowH);
  const colW = columnWidthPx(col);

  if (col === 'right') {
    return splitRichToFit(text, colW, boxH, {
      fontSize: FONT_PX,
      lineHeight: LINE_HEIGHT_PX,
      padding: '4px 6px',
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

  function notify() {
    hooks.onChange?.();
  }

  function notifyFocus(index) {
    focusedPage = index;
    hooks.onPageFocus?.(index + 1, model.pages.length);
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
      else if (rightHost?.value != null) model.pages[i].right = rightHost.value;
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
   * Cascade overflowing text from pageIndex's column onto following pages.
   * @param {number} pageIndex
   * @param {'left'|'right'|string} col
   */
  function spillColumn(pageIndex, col) {
    if (spilling) return false;
    if (col !== 'left' && col !== 'right') return false;
    if (!model.pages[pageIndex]) return false;

    spilling = true;
    const fromPage = pageIndex;
    let i = pageIndex;
    let didSpill = false;
    let iterations = 0;
    const headerH = cachedHeaderBlockH;
    const titlesH = cachedTitlesRowH;

    while (i < model.pages.length && iterations++ < 50) {
      const text = model.pages[i][col] || '';
      const pageHasHeader = model.pages[i].hasHeader;
      const { keep, spill } = splitTextToFit(
        text,
        col,
        pageHasHeader,
        pageHasHeader ? headerH : HEADER_BLOCK_H_PX,
        pageHasHeader ? titlesH : TITLES_ROW_H_PX,
      );
      if (!spill) break;
      didSpill = true;
      model.pages[i][col] = keep;
      if (i + 1 >= model.pages.length) {
        model.pages.push({ hasHeader: false, left: '', right: '' });
      }
      model.pages[i + 1][col] = spill + (model.pages[i + 1][col] || '');
      i += 1;
    }

    const toPage = i;
    if (didSpill) {
      render({ skipRead: true });
      requestAnimationFrame(() => {
        const pages = container.querySelectorAll('.diary-page');
        const pageEl = pages[toPage];
        if (!pageEl) {
          notifyFocus(toPage);
          return;
        }
        if (col === 'right') {
          const rf = rightFields.get(pageEl);
          if (rf) {
            rf.quill.focus();
            const len = Math.max(0, rf.quill.getLength() - 1);
            rf.quill.setSelection(len, 0, 'user');
            pageEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else {
          const ta = pageEl.querySelector(`[data-col="${col}"]`);
          if (ta) {
            ta.focus();
            const len = ta.value.length;
            try { ta.setSelectionRange(len, len); } catch (_) { /* ignore */ }
            ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
        notifyFocus(toPage);
      });
      notify();
      hooks.onSpill?.({
        fromPage: fromPage + 1,
        toPage: toPage + 1,
        col,
      });
    }

    spilling = false;
    return didSpill;
  }

  function checkOverflow(pageEl, pageIndex) {
    if (spilling) return;
    const overflowingCols = [];
    const left = pageEl.querySelector('[data-col="left"]');
    if (left instanceof HTMLTextAreaElement) {
      left.classList.remove('diary-box-overflow');
      left.closest('.diary-cell')?.classList.remove('diary-box-overflow');
      if (left.scrollHeight > left.clientHeight + 1) overflowingCols.push('left');
    }
    const rf = rightFields.get(pageEl);
    if (rf) {
      rf.quill.root.classList.remove('diary-box-overflow');
      pageEl.querySelector('[data-col="right"]')?.closest('.diary-cell')
        ?.classList.remove('diary-box-overflow');
      if (!rf.fitsInBox()) overflowingCols.push('right');
    }
    overflowingCols.forEach((col) => {
      spillColumn(pageIndex, col);
    });
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
      const existing = rightFields.get(pageEl);
      existing?.destroy?.();
      const placeholder = rightHost.getAttribute('data-placeholder') || 'यहाँ विवरण लिखें...';
      const field = mountQuill(rightHost, {
        placeholder,
        onFocus: () => notifyFocus(pageIndex),
        onChange: (html) => {
          if (spilling) return;
          model.pages[pageIndex].right = html;
          checkOverflow(pageEl, pageIndex);
          if (!spilling) notify();
        },
      });
      field.setContent(model.pages[pageIndex].right || '');
      rightFields.set(pageEl, field);
      hooks.onAttachField?.(field.quill.root, field);
    }

    pageEl.querySelectorAll('input[data-field], textarea[data-field]').forEach((el) => {
      el.addEventListener('input', () => {
        syncHeaderInputs(el, pageIndex);
        notify();
      });
      el.addEventListener('change', () => {
        syncHeaderInputs(el, pageIndex);
        notify();
      });
    });

    pageEl.querySelectorAll('[data-field].diary-dotted-flow').forEach((el) => {
      el.addEventListener('input', () => {
        syncHeaderInputs(el, pageIndex);
        onHeaderGeometryChange(pageEl, pageIndex);
        notify();
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
      });
    });

    pageEl.querySelectorAll('textarea[data-col]').forEach((ta) => {
      const runOverflow = () => {
        model.pages[pageIndex][ta.dataset.col] = ta.value;
        checkOverflow(pageEl, pageIndex);
        if (!spilling) notify();
      };
      ta.addEventListener('input', runOverflow);
      ta.addEventListener('paste', () => {
        requestAnimationFrame(runOverflow);
      });
      ta.addEventListener('focus', () => notifyFocus(pageIndex));
      ta.addEventListener('click', () => notifyFocus(pageIndex));
    });

    const toggle = pageEl.querySelector('.diary-header-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const nextState = !model.pages[pageIndex].hasHeader;
        model.pages[pageIndex].hasHeader = nextState;
        if (nextState && !model.pages[pageIndex].header) {
          model.pages[pageIndex].header = getPrefilledHeader(pageIndex);
        }
        render({ skipRead: true });
        notify();
      });
    }

    const delBtn = pageEl.querySelector('.diary-page-delete');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (model.pages.length <= 1) return;
        if (!confirm('Delete this page permanently? This cannot be undone.')) return;
        model.pages.splice(pageIndex, 1);
        render({ skipRead: true });
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
      addPage(false);
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
    model = normalizeDiaryModel(next);
    focusedPage = 0;
    render({ skipRead: true });
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

  return { setModel, getModel, clear, render, get pageCount() { return model.pages.length; } };
}
