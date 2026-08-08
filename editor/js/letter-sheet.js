/**
 * A4 letter sheet — Quill editors with continuous typing + spill.
 *
 * At 96dpi: 1in = 96px exactly.
 * Content height is snapped to a whole number of 24px lines so no line
 * ever splits across a page boundary on screen or in print.
 */

import {
  contentToPrintHtml,
  mountQuill,
  paginateRich,
  quillPrintCssFragment,
  splitRichToFit,
  stripHtmlToPlain,
} from './quill-pages.js';

const DPI = 96;
const MM_PER_IN = 25.4;

function mmToPx(mm) {
  return (mm / MM_PER_IN) * DPI;
}

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 25.4; // Google Docs default (1 inch)
const FONT_PX = 16;
const LINE_HEIGHT_PX = 24;

const PAGE_W_PX = mmToPx(PAGE_W_MM);
const PAGE_H_PX = mmToPx(PAGE_H_MM);
const MARGIN_PX = mmToPx(MARGIN_MM); // 96

const RAW_CONTENT_H_PX = PAGE_H_PX - 2 * MARGIN_PX; // ~930.52
const LINES_PER_PAGE = Math.floor(RAW_CONTENT_H_PX / LINE_HEIGHT_PX); // 38
const CONTENT_H_PX = LINES_PER_PAGE * LINE_HEIGHT_PX; // 912
const BOTTOM_MARGIN_EXTRA_PX = RAW_CONTENT_H_PX - CONTENT_H_PX; // ~18.52
const BOTTOM_MARGIN_PRINT_MM = MARGIN_MM + (BOTTOM_MARGIN_EXTRA_PX / DPI) * MM_PER_IN; // ~30.3
const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM; // 159.2
const CONTENT_W_PX = PAGE_W_PX - 2 * MARGIN_PX;

const LETTER_STYLE = {
  fontSize: FONT_PX,
  lineHeight: LINE_HEIGHT_PX,
  padding: '0',
};

/**
 * @deprecated Prefer live-page clone via export/print-document.js (runDocumentExport).
 * Print stylesheet — one A4 page card per letter page.
 */
export function letterPrintCss() {
  return `
    @page {
      size: A4;
      margin: ${MARGIN_MM}mm ${MARGIN_MM}mm ${BOTTOM_MARGIN_PRINT_MM.toFixed(2)}mm ${MARGIN_MM}mm;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .letter-print-page {
      width: ${CONTENT_W_MM}mm;
      height: ${CONTENT_H_PX}px;
      box-sizing: border-box;
      font-family: 'Noto Sans Devanagari', Arial, sans-serif;
      font-size: ${FONT_PX}px;
      line-height: ${LINE_HEIGHT_PX}px;
      white-space: pre-wrap;
      tab-size: 4;
      -moz-tab-size: 4;
      word-break: break-word;
      page-break-after: always;
      overflow: hidden;
    }
    /* ql-print white-space comes from quillPrintCssFragment (pre-wrap). */
    .letter-print-page:last-child {
      page-break-after: auto;
    }
    ${quillPrintCssFragment()}
  `;
}

/**
 * @deprecated Prefer live-page clone via export/print-document.js (runDocumentExport).
 * @param {string[]} pages
 */
export function letterPagesHtml(pages) {
  const list = pages?.length ? pages : [''];
  return list.map((text) => {
    const body = contentToPrintHtml(text);
    const isRich = /<\s*(p|div|strong|em|u|ul|li|img)\b/i.test(body);
    return `<div class="letter-print-page${isRich ? ' ql-print' : ''}">${body}</div>`;
  }).join('');
}

function splitTextToFit(text) {
  return splitRichToFit(text, CONTENT_W_PX, CONTENT_H_PX, LETTER_STYLE);
}

function paginateText(text) {
  return paginateRich(text, CONTENT_W_PX, CONTENT_H_PX, LETTER_STYLE);
}

/**
 * Diary-style letter pages: one A4 card per page, auto-spill on overflow.
 *
 * @param {HTMLElement} container  #letterPages
 * @param {HTMLElement|null} indicatorEl
 * @param {{
 *   onChange?: () => void,
 *   onAttachField?: (el: HTMLElement, field?: object) => void,
 *   onPageFocus?: (current: number, total: number) => void,
 *   onSpill?: (info: { fromPage: number, toPage: number }) => void,
 * }} [hooks]
 */
export function initLetterSheet(container, indicatorEl, hooks = {}) {
  /** @type {string[]} */
  let pages = [''];
  let spilling = false;
  let focusedPage = 0;
  /** @type {Map<number, object>} */
  const fields = new Map();

  function notify() {
    hooks.onChange?.();
  }

  function notifyFocus(pageIndex) {
    focusedPage = pageIndex;
    const total = Math.max(1, pages.length);
    const current = Math.min(total, Math.max(1, pageIndex + 1));
    if (indicatorEl) indicatorEl.textContent = `Page ${current} of ${total}`;
    hooks.onPageFocus?.(current, total);
  }

  function getText() {
    return pages.join('');
  }

  function getPlainText() {
    return pages.map((p) => stripHtmlToPlain(p)).join('');
  }

  function setText(text) {
    pages = paginateText(String(text ?? ''));
    render();
    notifyFocus(0);
  }

  function clear() {
    pages = [''];
    render();
    notifyFocus(0);
  }

  /**
   * Cascade overflowing text from pageIndex onto following pages.
   * @param {number} pageIndex
   */
  function spillFrom(pageIndex) {
    if (spilling) return;
    spilling = true;
    const fromPage = pageIndex;
    let i = pageIndex;
    let didSpill = false;
    let iterations = 0;

    while (i < pages.length && iterations++ < 50) {
      const text = pages[i] || '';
      const { keep, spill } = splitTextToFit(text);
      if (!spill) break;
      didSpill = true;
      pages[i] = keep;
      if (i + 1 >= pages.length) pages.push('');
      const next = pages[i + 1] || '';
      if (!next) pages[i + 1] = spill;
      else pages[i + 1] = spill + next;
      i += 1;
    }

    while (
      pages.length > 1
      && !stripHtmlToPlain(pages[pages.length - 1] || '').trim()
      && i < pages.length - 1
    ) {
      pages.pop();
    }

    const toPage = i;
    if (didSpill) {
      render();
      requestAnimationFrame(() => {
        const field = fields.get(toPage);
        if (field) {
          field.quill.focus();
          field.quill.setSelection(0, 0, 'user');
          field.host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        notifyFocus(toPage);
      });
      notify();
      hooks.onSpill?.({ fromPage: fromPage + 1, toPage: toPage + 1 });
    }

    spilling = false;
  }

  /**
   * @param {HTMLElement} pageEl
   * @param {number} pageIndex
   * @param {object} field
   */
  function wirePage(pageEl, pageIndex, field) {
    fields.set(pageIndex, field);

    field.quill.on('text-change', (_d, _o, source) => {
      if (source === 'silent' || spilling) return;
      pages[pageIndex] = field.getHtml();
      if (!field.fitsInBox()) {
        spillFrom(pageIndex);
      } else {
        notify();
      }
      notifyFocus(pageIndex);
    });

    hooks.onAttachField?.(field.quill.root, field);
  }

  function buildPageEl(text, pageIndex) {
    const pageEl = document.createElement('div');
    pageEl.className = 'letter-page';
    pageEl.dataset.pageIndex = String(pageIndex);

    const chrome = document.createElement('div');
    chrome.className = 'letter-page-chrome screen-only';
    chrome.innerHTML = `<span class="letter-page-label">Page ${pageIndex + 1}</span>`;
    pageEl.appendChild(chrome);

    const host = document.createElement('div');
    host.className = 'letter-page-input hinglish-input';
    pageEl.appendChild(host);

    const field = mountQuill(host, {
      placeholder: pageIndex === 0 ? 'यहाँ Hinglish में टाइप करें...' : '',
      onFocus: () => notifyFocus(pageIndex),
    });
    field.setContent(text || '');

    return { pageEl, field };
  }

  function render() {
    fields.forEach((f) => f.destroy());
    fields.clear();
    container.innerHTML = '';
    pages.forEach((text, i) => {
      const { pageEl, field } = buildPageEl(text, i);
      container.appendChild(pageEl);
      wirePage(pageEl, i, field);
    });

    const last = pages[pages.length - 1] || '';
    const lastField = fields.get(pages.length - 1);
    if (lastField && last && !lastField.fitsInBox()) {
      spillFrom(pages.length - 1);
      return;
    }

    notifyFocus(Math.min(focusedPage, pages.length - 1));
  }

  function update() {
    pages = paginateText(getText());
    render();
  }

  function focus() {
    const field = fields.get(focusedPage) || fields.get(0);
    field?.quill.focus();
  }

  /**
   * @returns {{ el: HTMLElement, field: object, start: number, end: number } | null}
   */
  function getActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('ql-editor')) {
      for (const [, field] of fields) {
        if (field.quill.root === active || field.quill.root.contains(active)) {
          const sel = field.quill.getSelection(true);
          const index = sel?.index ?? Math.max(0, field.quill.getLength() - 1);
          const length = sel?.length ?? 0;
          return {
            el: field.quill.root,
            field,
            start: index,
            end: index + length,
          };
        }
      }
    }
    const field = fields.get(focusedPage) || fields.get(0);
    if (!field) return null;
    const sel = field.quill.getSelection();
    const index = sel?.index ?? Math.max(0, field.quill.getLength() - 1);
    const length = sel?.length ?? 0;
    return {
      el: field.quill.root,
      field,
      start: index,
      end: index + length,
    };
  }

  render();

  return {
    update,
    getText,
    getPlainText,
    setText,
    clear,
    focus,
    getActiveField,
    get pageCount() { return pages.length; },
    getPages: () => pages.slice(),
  };
}
