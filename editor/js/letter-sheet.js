/**
 * A4 letter sheet — Quill editors with continuous typing + spill.
 *
 * At 96dpi: 1in = 96px exactly.
 * Content height is snapped to a whole number of 24px lines so no line
 * ever splits across a page boundary on screen or in print.
 */

import {
  caretIndexAfterTextChange,
  mountQuill,
  paginateRich,
  splitRichToFit,
  stripHtmlToPlain,
} from './quill-pages.js';
import { createEditHistory } from './edit-history.js';
import { createCaretOwnership } from './caret-ownership.js';

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

function splitTextToFit(text, liveRoot = null) {
  const width = liveRoot?.clientWidth > 0 ? liveRoot.clientWidth : CONTENT_W_PX;
  const height = liveRoot?.clientHeight > 0 ? liveRoot.clientHeight : CONTENT_H_PX;
  return splitRichToFit(text, width, height, {
    ...LETTER_STYLE,
    styleSource: liveRoot instanceof HTMLElement ? liveRoot : null,
  });
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
  const history = createEditHistory();
  // Spill and undo place the caret on the next frame; a click landing in that
  // window must win over the queued placement. Same rule as the diary sheet.
  const caretOwner = createCaretOwnership();

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

  function readCaret() {
    const field = fields.get(focusedPage) || fields.get(0);
    if (!field) return { pageIndex: 0, index: 0 };
    const sel = field.quill.getSelection();
    return {
      pageIndex: focusedPage,
      index: sel?.index ?? Math.max(0, field.quill.getLength() - 1),
    };
  }

  function cloneSnapshot() {
    return {
      pages: pages.slice(),
      caret: readCaret(),
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
   * @param {{ pages: string[], caret?: { pageIndex: number, index: number } }} snap
   */
  function applySnapshot(snap) {
    history.applying = true;
    pages = (snap.pages || ['']).slice();
    if (!pages.length) pages = [''];
    const caret = snap.caret || { pageIndex: 0, index: 0 };
    focusedPage = Math.max(0, Math.min(caret.pageIndex, pages.length - 1));
    render({ skipOpenRepair: true });
    // Only the caret placement is droppable — the history bookkeeping below
    // must run whether or not the user has clicked elsewhere since.
    const restore = caretOwner.owned(() => {
      const field = fields.get(focusedPage) || fields.get(0);
      if (!field) return;
      try { field.quill.root.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      const max = Math.max(0, field.quill.getLength() - 1);
      field.quill.setSelection(Math.min(Math.max(0, caret.index), max), 0, 'api');
    });
    requestAnimationFrame(() => {
      restore();
      history.applying = false;
      history.settle(cloneSnapshot());
      notify();
    });
  }

  function undo() {
    if (!history.canUndo) return false;
    history.settle(cloneSnapshot());
    const snap = history.undoOnce();
    if (!snap) return false;
    applySnapshot(/** @type {{ pages: string[], caret?: { pageIndex: number, index: number } }} */ (snap));
    return true;
  }

  function redo() {
    if (!history.canRedo) return false;
    history.settle(cloneSnapshot());
    const snap = history.redoOnce();
    if (!snap) return false;
    applySnapshot(/** @type {{ pages: string[], caret?: { pageIndex: number, index: number } }} */ (snap));
    return true;
  }

  function clearHistory() {
    history.clear();
  }

  function getText() {
    return pages.join('');
  }

  function getPlainText() {
    return pages.map((p) => stripHtmlToPlain(p)).join('');
  }

  function setText(text) {
    clearHistory();
    pages = paginateText(String(text ?? ''));
    render();
    notifyFocus(0);
    settleHistory();
  }

  function clear() {
    clearHistory();
    pages = [''];
    render();
    notifyFocus(0);
    settleHistory();
  }

  /**
   * Cascade overflowing text from pageIndex onto following pages.
   * @param {number} pageIndex
   */
  function spillFrom(pageIndex) {
    if (spilling || history.applying) return;
    spilling = true;
    const fromPage = pageIndex;
    let i = pageIndex;
    let didSpill = false;
    let iterations = 0;

    while (i < pages.length && iterations++ < 50) {
      const text = pages[i] || '';
      const liveRoot = fields.get(i)?.quill?.root || null;
      const { keep, spill } = splitTextToFit(text, liveRoot);
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
      // Following the spilled text onto the new page is right while the user is
      // typing, but not once they have clicked somewhere else in the meantime.
      const followSpill = caretOwner.owned(() => {
        const field = fields.get(toPage);
        if (field) {
          field.quill.focus();
          field.quill.setSelection(0, 0, 'user');
          field.host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        notifyFocus(toPage);
      });
      requestAnimationFrame(() => {
        followSpill();
        settleHistory();
      });
      notify();
      hooks.onSpill?.({ fromPage: fromPage + 1, toPage: toPage + 1 });
    }

    spilling = false;
    if (!didSpill) settleHistory();
  }

  /**
   * @param {HTMLElement} pageEl
   * @param {number} pageIndex
   * @param {object} field
   */
  function wirePage(pageEl, pageIndex, field) {
    fields.set(pageIndex, field);
    // Fields are rebuilt on every render, so re-arm the user-caret signal here.
    caretOwner.watchUserCaret(field.quill.root);

    field.quill.on('text-change', (delta, _o, source) => {
      if (source === 'silent' || spilling || history.applying) return;
      if (field.quill.root.isComposing) return;
      if (source === 'user') markUserEdit();
      pages[pageIndex] = field.getHtml();
      // Advance caret from the delta so spill restores onto the right page.
      void caretIndexAfterTextChange(field.quill, delta);
      if (!field.fitsInBox()) {
        spillFrom(pageIndex);
      } else {
        settleHistory();
        notify();
      }
      notifyFocus(pageIndex);
    });

    field.quill.root.addEventListener('compositionstart', () => {
      if (spilling || history.applying) return;
      markUserEdit();
    });

    field.quill.root.addEventListener('compositionend', () => {
      if (spilling || history.applying) return;
      pages[pageIndex] = field.getHtml();
      if (!field.fitsInBox()) spillFrom(pageIndex);
      else {
        settleHistory();
        notify();
      }
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

  /**
   * @param {{ skipOpenRepair?: boolean }} [opts]
   */
  function render(opts = {}) {
    fields.forEach((f) => f.destroy());
    fields.clear();
    container.innerHTML = '';
    pages.forEach((text, i) => {
      const { pageEl, field } = buildPageEl(text, i);
      container.appendChild(pageEl);
      wirePage(pageEl, i, field);
    });

    if (!opts.skipOpenRepair && !history.applying) {
      // Repair clip on open/render: spill the first page that already overflows.
      // Do not absorb or re-cut pages that fit.
      for (let i = 0; i < pages.length; i++) {
        const f = fields.get(i);
        if (f && (pages[i] || '') && !f.fitsInBox()) {
          spillFrom(i);
          return;
        }
      }
    }

    notifyFocus(Math.min(focusedPage, pages.length - 1));
  }

  function update() {
    pages = paginateText(getText());
    render();
    settleHistory();
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
  settleHistory();

  return {
    update,
    getText,
    getPlainText,
    setText,
    clear,
    focus,
    getActiveField,
    undo,
    redo,
    clearHistory,
    get pageCount() { return pages.length; },
    getPages: () => pages.slice(),
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
  };
}
