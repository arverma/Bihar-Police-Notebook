/**
 * A4 paged diary sheet — geometry + page UI + print helpers.
 *
 * Margin is half the Google Docs default (0.5in / 12.7mm).
 * Box heights snap to whole 24px lines so no line splits across pages.
 */

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
const LEFT_COL_PCT = 30;

const PAGE_W_PX = mmToPx(PAGE_W_MM);
const PAGE_H_PX = mmToPx(PAGE_H_MM);
const MARGIN_PX = mmToPx(MARGIN_MM); // 48

const CONTENT_H_RAW_PX = PAGE_H_PX - 2 * MARGIN_PX; // ~1026.52
const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM; // 184.6
const CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_MM; // 271.6

/** Fixed heights for header block + titles row when shown */
const HEADER_BLOCK_H_PX = 148;
const TITLES_ROW_H_PX = 72;

/**
 * Outer border of the bordered table, which sits outside the writing box and
 * must be reserved so the bottom rule is not clipped off the printed page.
 */
const TABLE_BORDER_H_PX = 4;
const TABLE_BORDER_W_PX = 4;
const HEADER_TOTAL_H_PX = HEADER_BLOCK_H_PX + TITLES_ROW_H_PX; // 240

function linesFor(availablePx) {
  return Math.floor(availablePx / LINE_HEIGHT_PX);
}

const BOX_LINES_WITH_HEADER = linesFor(CONTENT_H_RAW_PX - HEADER_TOTAL_H_PX); // 32
const BOX_LINES_NO_HEADER = linesFor(CONTENT_H_RAW_PX); // 42
const BOX_H_WITH_HEADER_PX = BOX_LINES_WITH_HEADER * LINE_HEIGHT_PX; // 768
const BOX_H_NO_HEADER_PX = BOX_LINES_NO_HEADER * LINE_HEIGHT_PX; // 1008

export const DIARY_PAGE = {
  WIDTH_MM: PAGE_W_MM,
  HEIGHT_MM: PAGE_H_MM,
  MARGIN_MM,
  CONTENT_W_MM,
  CONTENT_H_MM,
  FONT_PX,
  LINE_HEIGHT_PX,
  LEFT_COL_PCT,
  MARGIN_PX,
  WIDTH_PX: PAGE_W_PX,
  HEIGHT_PX: PAGE_H_PX,
  HEADER_BLOCK_H_PX,
  TITLES_ROW_H_PX,
  HEADER_TOTAL_H_PX,
  BOX_LINES_WITH_HEADER,
  BOX_LINES_NO_HEADER,
  BOX_H_WITH_HEADER_PX,
  BOX_H_NO_HEADER_PX,
};

export const HEADER_FIELDS = [
  'case_diary_no', 'rule_no', 'against_1', 'against_2', 'special_report_no',
  'thana', 'district', 'fir_number', 'fir_date', 'event_date_place',
  'sections', 'investigation_record',
];

export function emptyHeader() {
  const h = {};
  HEADER_FIELDS.forEach((k) => { h[k] = ''; });
  return h;
}

export function emptyModel() {
  return {
    header: emptyHeader(),
    pages: [{ hasHeader: true, left: '', right: '' }],
  };
}

/**
 * Normalize stored content into { header, pages }.
 * Supports legacy flat { left_box, right_box, ...fields } shape.
 */
export function normalizeDiaryModel(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch (_) { data = {}; }
  }
  if (!data || typeof data !== 'object') data = {};

  if (Array.isArray(data.pages)) {
    const header = emptyHeader();
    HEADER_FIELDS.forEach((k) => {
      if (data.header && k in data.header) header[k] = data.header[k] ?? '';
      else if (k in data) header[k] = data[k] ?? '';
    });
    const pages = data.pages.map((p, i) => ({
      hasHeader: p.hasHeader != null ? Boolean(p.hasHeader) : i === 0,
      left: p.left ?? '',
      right: p.right ?? '',
    }));
    if (!pages.length) pages.push({ hasHeader: true, left: '', right: '' });
    return { header, pages };
  }

  // Legacy flat format
  const header = emptyHeader();
  HEADER_FIELDS.forEach((k) => {
    if (k in data) header[k] = data[k] ?? '';
  });
  return {
    header,
    pages: [{
      hasHeader: true,
      left: data.left_box ?? '',
      right: data.right_box ?? '',
    }],
  };
}

export function diaryHasMeaningfulContent(model) {
  const m = normalizeDiaryModel(model);
  if (Object.values(m.header).some((v) => String(v).trim())) return true;
  return m.pages.some((p) => String(p.left).trim() || String(p.right).trim());
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boxHeightPx(hasHeader) {
  return hasHeader ? BOX_H_WITH_HEADER_PX : BOX_H_NO_HEADER_PX;
}

function cellPadBottomPx(hasHeader) {
  const used =
    (hasHeader ? HEADER_TOTAL_H_PX : 0) + boxHeightPx(hasHeader) + TABLE_BORDER_H_PX;
  return Math.max(0, CONTENT_H_RAW_PX - used);
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
    .diary-print-header {
      flex: 0 0 auto;
      max-height: ${HEADER_BLOCK_H_PX}px;
      overflow: hidden;
      box-sizing: border-box;
      font-size: 13px;
      line-height: 1.4;
      margin: 0 0 4px;
      padding: 0;
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
    .diary-print-header .sched-1 {
      grid-row: 1;
    }
    .diary-print-header .sched-2 {
      grid-row: 2;
    }
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
    .diary-print-header .against-line {
      grid-row: 3;
    }
    .diary-print-header .special-line {
      grid-row: 4;
    }
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
    .diary-print-header .dotted.narrow {
      min-width: 56px;
    }
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
    .diary-print-header .divider {
      margin-top: 6px;
      border-top: 1.5px solid #000;
    }
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
      height: ${TITLES_ROW_H_PX}px;
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
  `;
}

function printHeaderHtml(header) {
  const dotted = (k, cls = '') => {
    const v = header[k];
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
        <div class="rule">(नियम-${dotted('rule_no', 'narrow')})</div>
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
      <div class="meta-row">
        घटना की तिथि और स्थान ${dotted('event_date_place', 'wide')}
        धारा ${dotted('sections', 'wide')}
      </div>
      <div class="divider"></div>
    </div>
  `;
}

/**
 * Build print HTML from the diary model (same geometry as screen).
 */
export function diaryPagesHtml(model) {
  const m = normalizeDiaryModel(model);
  return m.pages.map((page, i) => {
    const h = page.hasHeader;
    const boxH = boxHeightPx(h) + cellPadBottomPx(h);
    const titles = h ? `
      <tr>
        <th class="left-col">किन तिथि को (समय सहित) कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया</th>
        <th class="right-col">
          अन्वेषण का अभिलेख
          ${m.header.investigation_record
            ? `<div>(${escapeHtml(m.header.investigation_record)})</div>`
            : ''}
        </th>
      </tr>
    ` : '';
    const headerBlock = h ? printHeaderHtml(m.header) : '';
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
              <div class="diary-print-body" style="height:${boxH}px;">${escapeHtml(page.right)}</div>
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

const CONTENT_W_PX = mmToPx(CONTENT_W_MM);

/**
 * Width of a diary column's writing area. Measured from a live page when one
 * exists so the mirror wraps exactly like the on-screen cell (and therefore
 * like the print output); otherwise estimated from the collapsed table borders.
 */
function columnWidthPx(col) {
  const live = document.querySelector(`.diary-page .fir-input[data-col="${col}"]`);
  if (live && live.clientWidth > 0) return live.clientWidth;
  const colPct = col === 'left' ? LEFT_COL_PCT : 100 - LEFT_COL_PCT;
  return ((CONTENT_W_PX - TABLE_BORDER_W_PX) * colPct) / 100;
}

/**
 * Split text to fit a diary column box without requiring a live page textarea.
 * @param {string} text
 * @param {'left'|'right'} col
 * @param {boolean} hasHeader
 */
function splitTextToFit(text, col, hasHeader) {
  if (!text) return { keep: '', spill: '' };
  const boxH = boxHeightPx(hasHeader) + cellPadBottomPx(hasHeader);
  const colW = columnWidthPx(col);

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
  /** @type {{ header: Record<string,string>, pages: Array<{hasHeader:boolean,left:string,right:string}> }} */
  let model = emptyModel();
  let focusedPage = 0;
  let spilling = false;

  function notify() {
    hooks.onChange?.();
  }

  function notifyFocus(index) {
    focusedPage = index;
    hooks.onPageFocus?.(index + 1, model.pages.length);
  }

  function syncHeaderInputs(sourceEl) {
    const field = sourceEl.dataset.field;
    if (!HEADER_FIELDS.includes(field)) return;
    const value = sourceEl.value;
    model.header[field] = value;
    container.querySelectorAll(`[data-field="${field}"]`).forEach((el) => {
      if (el !== sourceEl) el.value = value;
    });
  }

  function readModelFromDom() {
    const firstHeader = container.querySelector('.diary-page[data-has-header="true"]');
    const headerSrc = firstHeader || container.querySelector('.diary-page');
    if (headerSrc) {
      HEADER_FIELDS.forEach((k) => {
        const el = headerSrc.querySelector(`[data-field="${k}"]`);
        if (el) model.header[k] = el.value || '';
      });
    }
    const inv = container.querySelector('[data-field="investigation_record"]');
    if (inv) model.header.investigation_record = inv.value || '';

    container.querySelectorAll('.diary-page').forEach((pageEl, i) => {
      if (!model.pages[i]) return;
      model.pages[i].hasHeader = pageEl.dataset.hasHeader === 'true';
      const left = pageEl.querySelector('[data-col="left"]');
      const right = pageEl.querySelector('[data-col="right"]');
      if (left) model.pages[i].left = left.value;
      if (right) model.pages[i].right = right.value;
    });
  }

  function applyBoxHeights(pageEl, hasHeader) {
    const h = boxHeightPx(hasHeader) + cellPadBottomPx(hasHeader);
    pageEl.style.setProperty('--diary-box-h', `${h}px`);
    pageEl.querySelectorAll('.diary-cell').forEach((cell) => {
      cell.style.height = `${h}px`;
    });
    pageEl.querySelectorAll('[data-col]').forEach((ta) => {
      ta.style.height = '';
    });
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

    while (i < model.pages.length && iterations++ < 50) {
      const text = model.pages[i][col] || '';
      const { keep, spill } = splitTextToFit(text, col, model.pages[i].hasHeader);
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
        const ta = pages[toPage]?.querySelector(`[data-col="${col}"]`);
        if (ta) {
          ta.focus();
          const len = ta.value.length;
          try { ta.setSelectionRange(len, len); } catch (_) { /* ignore */ }
          ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    pageEl.querySelectorAll('[data-col]').forEach((ta) => {
      const cell = ta.closest('.diary-cell');
      ta.classList.remove('diary-box-overflow');
      cell?.classList.remove('diary-box-overflow');
      if (ta.scrollHeight > ta.clientHeight + 1) {
        overflowingCols.push(ta.dataset.col);
      }
    });
    overflowingCols.forEach((col) => {
      spillColumn(pageIndex, col);
    });
  }

  function wirePage(pageEl, pageIndex) {
    applyBoxHeights(pageEl, model.pages[pageIndex].hasHeader);

    pageEl.querySelectorAll('input[data-field], textarea[data-field], textarea[data-col]').forEach((el) => {
      hooks.onAttachField?.(el);
    });

    pageEl.querySelectorAll('input[data-field]').forEach((el) => {
      el.addEventListener('input', () => {
        syncHeaderInputs(el);
        notify();
      });
      el.addEventListener('change', () => {
        syncHeaderInputs(el);
        notify();
      });
    });

    pageEl.querySelectorAll('[data-col]').forEach((ta) => {
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
        model.pages[pageIndex].hasHeader = !model.pages[pageIndex].hasHeader;
        render({ skipRead: true });
        notify();
      });
    }

    const delBtn = pageEl.querySelector('.diary-page-delete');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (model.pages.length <= 1) return;
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
      if (el) el.value = model.header[k] || '';
    });

    const left = pageEl.querySelector('[data-col="left"]');
    const right = pageEl.querySelector('[data-col="right"]');
    if (left) left.value = page.left || '';
    if (right) right.value = page.right || '';

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
      if (!spilling) {
        requestAnimationFrame(() => {
          if (!pageEl.isConnected) return;
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

  function addPage(hasHeader) {
    if (container.dataset.adding === '1') return;
    container.dataset.adding = '1';
    model.pages.push({ hasHeader: Boolean(hasHeader), left: '', right: '' });
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
      header: { ...model.header },
      pages: model.pages.map((p) => ({ ...p })),
    };
  }

  function clear() {
    setModel(emptyModel());
  }

  render();

  return { setModel, getModel, clear, render, get pageCount() { return model.pages.length; } };
}
