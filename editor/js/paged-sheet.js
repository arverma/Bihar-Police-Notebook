/**
 * A4 paged letter sheet — diary-style page cards with continuous typing + spill.
 *
 * At 96dpi: 1in = 96px exactly.
 * Content height is snapped to a whole number of 24px lines so no line
 * ever splits across a page boundary on screen or in print.
 */

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
const CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_MM; // 246.2

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
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
      word-break: break-word;
      page-break-after: always;
      overflow: hidden;
    }
    .letter-print-page:last-child {
      page-break-after: auto;
    }
  `;
}

/**
 * @param {string[]} pages
 */
export function letterPagesHtml(pages) {
  const list = pages?.length ? pages : [''];
  return list.map((text) => (
    `<div class="letter-print-page">${escapeHtml(text)}</div>`
  )).join('');
}

/**
 * Spill text that overflows a fixed-height textarea at the last whitespace
 * boundary that still fits.
 * @param {HTMLTextAreaElement} textarea
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
  // Prefer breaking at a newline near the cut; fall back to a space.
  const lookNl = full.lastIndexOf('\n', cut);
  if (lookNl >= Math.floor(cut * 0.5)) {
    cut = lookNl + 1;
  } else {
    const lookBack = full.lastIndexOf(' ', cut);
    if (lookBack > cut * 0.6) cut = lookBack + 1;
  }

  textarea.value = full.slice(0, cut);
  while (cut > 0 && textarea.scrollHeight > textarea.clientHeight + 1) {
    const prev = Math.max(full.lastIndexOf('\n', cut - 2), full.lastIndexOf(' ', cut - 2));
    cut = prev > 0 ? prev + 1 : cut - 1;
    textarea.value = full.slice(0, cut);
  }

  return { keep: full.slice(0, cut), spill: full.slice(cut) };
}

/**
 * @param {string} text
 */
function splitTextToFit(text) {
  if (!text) return { keep: '', spill: '' };
  const ta = document.createElement('textarea');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    `width:${PAGE_W_PX - 2 * MARGIN_PX}px`,
    `height:${CONTENT_H_PX}px`,
    'box-sizing:border-box',
    'border:none',
    'padding:0',
    'margin:0',
    `font-size:${FONT_PX}px`,
    `line-height:${LINE_HEIGHT_PX}px`,
    "font-family:'Noto Sans Devanagari', Arial, sans-serif",
    'white-space:pre-wrap',
    'word-break:break-word',
    'overflow:hidden',
  ].join(';');
  document.body.appendChild(ta);
  ta.value = text;
  const result = splitOverflow(ta);
  document.body.removeChild(ta);
  return result;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function paginateText(text) {
  const pages = [];
  let rest = text ?? '';
  let guard = 0;
  while (guard++ < 200) {
    if (!rest) {
      pages.push('');
      break;
    }
    const { keep, spill } = splitTextToFit(rest);
    pages.push(keep);
    if (!spill) break;
    rest = spill;
  }
  if (!pages.length) pages.push('');
  return pages;
}

/**
 * Diary-style letter pages: one A4 card per page, auto-spill on overflow.
 *
 * @param {HTMLElement} container  #letterPages
 * @param {HTMLElement|null} indicatorEl
 * @param {{
 *   onChange?: () => void,
 *   onAttachField?: (el: HTMLTextAreaElement) => void,
 *   onPageFocus?: (current: number, total: number) => void,
 *   onSpill?: (info: { fromPage: number, toPage: number }) => void,
 * }} [hooks]
 */
export function initPagedSheet(container, indicatorEl, hooks = {}) {
  /** @type {string[]} */
  let pages = [''];
  let spilling = false;
  let focusedPage = 0;

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
      pages[i + 1] = spill + (pages[i + 1] || '');
      i += 1;
    }

    // Drop trailing empty pages (keep at least one)
    while (pages.length > 1 && !(pages[pages.length - 1] || '').trim() && i < pages.length - 1) {
      pages.pop();
    }

    const toPage = i;
    if (didSpill) {
      render();
      requestAnimationFrame(() => {
        const pageEls = container.querySelectorAll('.letter-page');
        const ta = pageEls[toPage]?.querySelector('textarea');
        if (ta) {
          ta.focus();
          try { ta.setSelectionRange(0, 0); } catch (_) { /* ignore */ }
          ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
   */
  function wirePage(pageEl, pageIndex) {
    const ta = pageEl.querySelector('textarea');
    if (!ta) return;

    ta.addEventListener('input', () => {
      pages[pageIndex] = ta.value;
      if (ta.scrollHeight > ta.clientHeight + 1) {
        spillFrom(pageIndex);
      } else {
        // Trim empty trailing pages when deleting
        if (
          pageIndex === pages.length - 1 &&
          pages.length > 1 &&
          !(pages[pageIndex] || '').trim() &&
          !(pages[pageIndex - 1] || '').endsWith('\n')
        ) {
          // keep empty last page for typing comfort
        }
        notify();
      }
      notifyFocus(pageIndex);
    });

    ta.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        pages[pageIndex] = ta.value;
        if (ta.scrollHeight > ta.clientHeight + 1) spillFrom(pageIndex);
        else notify();
      });
    });

    ta.addEventListener('focus', () => notifyFocus(pageIndex));
    ta.addEventListener('click', () => notifyFocus(pageIndex));
    ta.addEventListener('keyup', () => notifyFocus(pageIndex));

    hooks.onAttachField?.(ta);
  }

  function buildPageEl(text, pageIndex) {
    const pageEl = document.createElement('div');
    pageEl.className = 'letter-page';
    pageEl.dataset.pageIndex = String(pageIndex);

    const chrome = document.createElement('div');
    chrome.className = 'letter-page-chrome screen-only';
    chrome.innerHTML = `<span class="letter-page-label">Page ${pageIndex + 1}</span>`;
    pageEl.appendChild(chrome);

    const ta = document.createElement('textarea');
    ta.className = 'letter-page-input hinglish-input';
    ta.setAttribute('autocomplete', 'off');
    if (pageIndex === 0) {
      ta.placeholder = 'यहाँ Hinglish में टाइप करें...';
    }
    ta.value = text || '';
    pageEl.appendChild(ta);

    return pageEl;
  }

  function render() {
    container.innerHTML = '';
    pages.forEach((text, i) => {
      const pageEl = buildPageEl(text, i);
      container.appendChild(pageEl);
      wirePage(pageEl, i);
    });

    // Ensure at least one empty trailing page isn't needed — always have room
    const last = pages[pages.length - 1] || '';
    const lastTa = container.querySelector('.letter-page:last-child textarea');
    if (lastTa && last && lastTa.scrollHeight > lastTa.clientHeight + 1) {
      spillFrom(pages.length - 1);
      return;
    }

    notifyFocus(Math.min(focusedPage, pages.length - 1));
  }

  function update() {
    // Re-paginate from joined text (e.g. after external set)
    const joined = getText();
    pages = paginateText(joined);
    render();
  }

  function focus() {
    const pageEls = container.querySelectorAll('.letter-page');
    const ta = pageEls[focusedPage]?.querySelector('textarea')
      || pageEls[0]?.querySelector('textarea');
    ta?.focus();
  }

  /**
   * @returns {{ el: HTMLTextAreaElement, start: number, end: number } | null}
   */
  function getActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && active.closest('.letter-page')) {
      return {
        el: active,
        start: active.selectionStart ?? active.value.length,
        end: active.selectionEnd ?? active.value.length,
      };
    }
    const pageEls = container.querySelectorAll('.letter-page');
    const ta = pageEls[focusedPage]?.querySelector('textarea')
      || pageEls[0]?.querySelector('textarea');
    if (!ta) return null;
    return {
      el: ta,
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  }

  render();

  return {
    update,
    getText,
    setText,
    clear,
    focus,
    getActiveField,
    get pageCount() { return pages.length; },
    getPages: () => pages.slice(),
  };
}
