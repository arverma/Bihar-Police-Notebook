/**
 * Quill 2 helpers for letter pages + diary right column.
 * Expects window.Quill from the CDN script in index.html.
 */

import { splitRichToFitStatic } from './page-fit.js';

const RICH_TAG_RE = /<\s*(p|div|br|strong|b|em|i|u|ul|ol|li|img|span)\b/i;
const MAX_IMAGE_EDGE = 800;
const JPEG_QUALITY = 0.7;
const MAX_DATA_URL_CHARS = 700_000;

/** @type {import('quill').default | null} */
let activeQuill = null;
/** @type {HTMLElement | null} */
let toolbarEl = null;
/** @type {WeakMap<object, object>} */
const quillByHost = new WeakMap();
/** @type {WeakMap<HTMLElement, object>} */
const fieldByEditor = new WeakMap();

function getQuillCtor() {
  const Q = typeof window !== 'undefined' ? window.Quill : null;
  if (!Q) throw new Error('Quill CDN not loaded');
  return Q;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
export function isPlainDocContent(s) {
  const t = String(s ?? '');
  if (!t.trim()) return true;
  return !RICH_TAG_RE.test(t);
}

/**
 * @param {string} html
 * @returns {string}
 */
export function stripHtmlToPlain(html) {
  const s = String(html ?? '');
  if (!s) return '';
  if (isPlainDocContent(s)) return s;
  const div = document.createElement('div');
  div.innerHTML = s;
  return (div.textContent || '').replace(/\u00a0/g, ' ');
}

/**
 * Allowlisted sanitize for stored / printed Quill HTML.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeQuillHtml(html) {
  const raw = String(html ?? '');
  if (!raw.trim()) return '';
  // Plain text may still carry Quill getSemanticHTML() &nbsp; / U+00A0.
  if (isPlainDocContent(raw)) {
    return raw.replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ');
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = raw;
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'IMG', 'SPAN', 'DIV']);
  const emptyBlocks = new Set(['P', 'LI', 'DIV']);
  const walk = (node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Persist/print only: strip NBSP to U+0020 so stored HTML and print
        // stay wrap-friendly. On restore, htmlForQuillPaste re-encodes spaces
        // for Quill 2.0.3 clipboard ingest — do not skip this step.
        if (child.nodeValue && child.nodeValue.includes('\u00a0')) {
          child.nodeValue = child.nodeValue.replace(/\u00a0/g, ' ');
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      const el = /** @type {HTMLElement} */ (child);
      // Live DOM may include Quill caret chrome; never persist it.
      if (el.classList?.contains('ql-cursor') || el.classList?.contains('ql-ui')) {
        el.remove();
        continue;
      }
      if (!allowed.has(el.tagName)) {
        const parent = el.parentNode;
        while (el.firstChild) parent?.insertBefore(el.firstChild, el);
        el.remove();
        continue;
      }
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (el.tagName === 'IMG') {
          if (name === 'src') {
            const v = attr.value || '';
            if (!v.startsWith('data:image/') && !/^https?:\/\//i.test(v)) {
              el.removeAttribute(attr.name);
            }
          } else if (name !== 'alt') {
            el.removeAttribute(attr.name);
          }
          return;
        }
        if (name === 'class') {
          const kept = (attr.value || '')
            .split(/\s+/)
            .filter((c) => /^ql-align-/.test(c));
          if (kept.length) el.setAttribute('class', kept.join(' '));
          else el.removeAttribute('class');
          return;
        }
        if (name === 'style') {
          const align = /text-align\s*:\s*(left|center|right|justify)/i.exec(attr.value || '');
          if (align) el.setAttribute('style', `text-align: ${align[1].toLowerCase()}`);
          else el.removeAttribute('style');
          return;
        }
        el.removeAttribute(attr.name);
      });
      walk(el);
    }
  };
  walk(tpl.content);

  // Canonical empty blocks: <p></p> (from getSemanticHTML) has zero height
  // outside live Quill. Match live DOM: <p><br></p>.
  const fillEmptyBlocks = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = /** @type {HTMLElement} */ (child);
      fillEmptyBlocks(el);
      if (!emptyBlocks.has(el.tagName)) continue;
      const hasContent = [...el.childNodes].some((n) => {
        if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue || '').length > 0;
        return n.nodeType === Node.ELEMENT_NODE;
      });
      if (!hasContent) el.appendChild(document.createElement('br'));
    }
  };
  fillEmptyBlocks(tpl.content);

  return tpl.innerHTML;
}

/**
 * Adapt sanitized HTML for Quill clipboard ingest only — never persist this output.
 * Quill 2.0.3 matchText collapses/trims U+0020 but preserves U+00A0 through import,
 * then converts NBSP back to ordinary spaces in the Delta. Re-check on Quill upgrade.
 * @param {string} html sanitized HTML (from sanitizeQuillHtml)
 * @returns {string}
 */
export function htmlForQuillPaste(html) {
  const raw = String(html ?? '');
  if (!raw.trim()) return '';
  if (isPlainDocContent(raw)) {
    return raw.replace(/ /g, '\u00a0');
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = raw;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue && child.nodeValue.includes(' ')) {
          child.nodeValue = child.nodeValue.replace(/ /g, '\u00a0');
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/**
 * HTML suitable for print injection (plain → escaped pre-wrap text).
 * @param {string} content
 * @returns {string}
 */
export function contentToPrintHtml(content) {
  const s = String(content ?? '');
  if (!s) return '';
  if (isPlainDocContent(s)) {
    return escapePrintText(s);
  }
  return sanitizeQuillHtml(s);
}

function escapePrintText(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** CSS fragment for Quill-formatted print bodies (match live .ql-editor). */
export function quillPrintCssFragment() {
  return `
    .ql-print {
      white-space: pre-wrap;
      tab-size: 4;
      -moz-tab-size: 4;
      overflow-wrap: break-word;
      word-wrap: break-word;
      word-break: normal;
    }
    .ql-print strong, .ql-print b { font-weight: 700; }
    .ql-print em, .ql-print i { font-style: italic; }
    .ql-print u { text-decoration: underline; }
    .ql-print ul,
    .ql-print ol {
      margin: 0;
      padding-left: 1.4em;
    }
    .ql-print li { list-style: disc; }
    .ql-print ol > li { list-style: decimal; }
    .ql-print img { max-width: 100%; height: auto; display: block; margin: 0.25em 0; }
    .ql-print .ql-align-center, .ql-print [style*="text-align: center"] { text-align: center; }
    .ql-print .ql-align-right, .ql-print [style*="text-align: right"] { text-align: right; }
    .ql-print .ql-align-justify, .ql-print [style*="text-align: justify"] { text-align: justify; }
    .ql-print .ql-align-left, .ql-print [style*="text-align: left"] { text-align: left; }
    .ql-print p { margin: 0; }
  `;
}

/**
 * Wire the shared chrome toolbar (#quillToolbar).
 * @param {HTMLElement} el
 */
export function initQuillToolbar(el) {
  toolbarEl = el;
  el.hidden = false;
  el.addEventListener('mousedown', (e) => {
    // Keep editor selection when clicking toolbar
    e.preventDefault();
  });
  el.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-ql]') : null;
    if (!(btn instanceof HTMLElement) || !activeQuill) return;
    const cmd = btn.dataset.ql || '';
    if (cmd.startsWith('align:')) {
      const v = cmd.slice(6);
      const cur = activeFormat().align;
      activeQuill.format('align', cur === v ? false : v);
      syncToolbarUi();
      return;
    }
    if (cmd === 'list') {
      const cur = activeFormat().list;
      activeQuill.format('list', cur === 'ordered' ? false : 'ordered');
      syncToolbarUi();
      return;
    }
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') {
      const cur = Boolean(activeFormat()[cmd]);
      activeQuill.format(cmd, !cur);
      syncToolbarUi();
    }
  });
  bindToolbarViewportOffset();
}

function setToolbarVisible(show) {
  if (!toolbarEl) return;
  toolbarEl.hidden = false;
  updateToolbarViewportOffset();
}

/** @type {boolean} */
let vvBound = false;

function bindToolbarViewportOffset() {
  if (vvBound || typeof window === 'undefined') return;
  vvBound = true;
  const vv = window.visualViewport;
  const onChange = () => updateToolbarViewportOffset();
  window.addEventListener('resize', onChange);
  if (vv) {
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
  }
}

function clearToolbarViewportOffset() {
  if (!toolbarEl) return;
  toolbarEl.style.removeProperty('--quill-tb-bottom');
}

/**
 * On narrow viewports, lift the floating toolbar above the soft keyboard
 * using visualViewport; otherwise leave CSS breakpoint defaults.
 */
function updateToolbarViewportOffset() {
  if (!toolbarEl || toolbarEl.hidden) return;
  const narrow = typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches;
  if (!narrow) {
    clearToolbarViewportOffset();
    return;
  }
  const vv = window.visualViewport;
  const floorPx = 12;
  let keyboardLift = 0;
  if (vv) {
    keyboardLift = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  }
  const bottomPx = Math.max(floorPx, keyboardLift + 8);
  toolbarEl.style.setProperty('--quill-tb-bottom', `calc(var(--overlay-bottom, 0px) + ${bottomPx}px)`);
}

/**
 * Formats at the active selection. Quill's `getFormat()` defaults to
 * `getSelection(true)`, which is null while an editor is focused but has no
 * range yet (during caret restore), and then throws.
 * @returns {Record<string, any>}
 */
function activeFormat() {
  if (!activeQuill) return {};
  const range = activeQuill.getSelection();
  if (!range) return {};
  try {
    return activeQuill.getFormat(range) || {};
  } catch (_) {
    return {};
  }
}

function syncToolbarUi() {
  if (!toolbarEl) return;
  const fmt = activeFormat();
  toolbarEl.querySelectorAll('[data-ql]').forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const cmd = btn.dataset.ql || '';
    let on = false;
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') on = Boolean(fmt[cmd]);
    else if (cmd === 'list') on = fmt.list === 'ordered';
    else if (cmd.startsWith('align:')) {
      const v = cmd.slice(6);
      on = fmt.align === v;
    }
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/**
 * @param {object | null} quill
 */
export function setActiveQuill(quill) {
  activeQuill = quill;
  setToolbarVisible(true);
  syncToolbarUi();
}

/**
 * @param {HTMLElement} editorRoot .ql-editor
 * @returns {object | null}
 */
export function getFieldForEditor(editorRoot) {
  return fieldByEditor.get(editorRoot) || null;
}

/**
 * @param {object} quill
 * @param {string} content plain or HTML
 */
export function setQuillContent(quill, content) {
  const s = String(content ?? '');
  const silent = () => {
    if (isPlainDocContent(s)) {
      quill.setText(s, 'silent');
    } else {
      const clean = sanitizeQuillHtml(s);
      quill.setText('', 'silent');
      quill.clipboard.dangerouslyPasteHTML(0, htmlForQuillPaste(clean) || '', 'silent');
    }
    // Drop trailing selection noise, but only for the editor the user is in.
    // Offscreen measurement mirrors and unfocused pages share this path, and
    // setting a selection there moves the document range out of the focused
    // editor, which leaves the caret invisible.
    const len = quill.getLength();
    if (len > 0 && quill.hasFocus()) quill.setSelection(Math.min(len - 1, len), 0, 'silent');
    // Fixed-height diary boxes must never scroll — clipping means we failed to spill.
    quill.root.scrollTop = 0;
  };
  silent();
}

/**
 * @param {object} quill
 * @returns {string}
 */
/**
 * Caret index after a Quill text-change, derived from the delta itself.
 *
 * Not from the selection: by the time this runs Quill has already moved the
 * selection past a user insert, so adding the inserted length on top of it put
 * the caret one keystroke to the right of the text on every edit — and that
 * offset is what every reflow then used to place the caret. Reading it from
 * the delta is also source-independent, which the selection is not: `user`,
 * `api` and paste all update the selection at different moments.
 *
 * A delta is in document order, so walking retains gives the position of the
 * change and the last insert/delete gives where the caret ends up. A delta
 * that only changes formatting moves nothing, and leaves the caret alone.
 * @param {object} quill
 * @param {{ ops?: object[] } | null | undefined} delta
 * @returns {number}
 */
export function caretIndexAfterTextChange(quill, delta) {
  let pos = 0;
  /** End of the last op that actually changed text, or null if none did. */
  let changeEnd = null;
  for (const op of delta?.ops || []) {
    if (typeof op.retain === 'number') {
      pos += op.retain;
    } else if (typeof op.insert === 'string') {
      pos += op.insert.length;
      changeEnd = pos;
    } else if (op.insert != null) {
      pos += 1;
      changeEnd = pos;
    } else if (typeof op.delete === 'number') {
      // Deleted text is gone; the caret stays where it began.
      changeEnd = pos;
    }
  }
  const max = Math.max(0, quill.getLength() - 1);
  if (changeEnd == null) {
    const sel = quill.getSelection();
    return Math.max(0, Math.min(sel?.index ?? max, max));
  }
  return Math.max(0, Math.min(changeEnd, max));
}

/**
 * Sanitized HTML for whatever the editor currently holds, including runs of
 * empty paragraphs. Prefer live `root.innerHTML` over `getSemanticHTML()`:
 * Quill 2 semantic HTML emits bare `<p></p>` (Break blot length is 0), which
 * collapses outside live Quill — static clones, fit probes, and print/PDF.
 * Live DOM keeps `<p><br></p>`; sanitize canonicalizes that shape.
 * @param {object} quill
 * @returns {string}
 */
export function getQuillHtmlPreservingBlanks(quill) {
  let html = '';
  try {
    html = quill.root?.innerHTML ?? '';
  } catch (_) {
    html = '';
  }
  return sanitizeQuillHtml(html);
}

/**
 * @param {object} quill
 * @returns {string}
 */
export function getQuillHtml(quill) {
  const plain = (quill.getText() || '').replace(/\n$/, '');
  if (!plain.trim() && !quill.root.querySelector('img')) return '';
  const clean = getQuillHtmlPreservingBlanks(quill);
  if (!stripHtmlToPlain(clean).trim() && !/<img\b/i.test(clean)) return '';
  return clean;
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unsupported'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        reject(new Error('Image too large after compression'));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/**
 * @param {object} quill
 */
async function pickAndInsertImage(quill) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  const file = await new Promise((resolve) => {
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  document.body.removeChild(input);
  if (!file) return;
  try {
    const dataUrl = await resizeImageToDataUrl(file);
    const range = quill.getSelection(true) || { index: quill.getLength() - 1, length: 0 };
    quill.insertEmbed(range.index, 'image', dataUrl, 'user');
    quill.setSelection(range.index + 1, 0, 'user');
  } catch (err) {
    console.warn('Image insert failed:', err);
  }
}

function editorFits(quill) {
  const root = quill.root;
  if (root.scrollTop > 0) return false;
  return root.scrollHeight <= root.clientHeight + 1;
}

/**
 * Split rich/plain content to fit a fixed box. Returns HTML/plain keep+spill.
 * Uses the static (non-Quill) probe from page-fit.js — no second Selection.
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{ fontSize?: number, lineHeight?: number, padding?: string, styleSource?: HTMLElement | null }} [style]
 * @returns {{ keep: string, spill: string }}
 */
export function splitRichToFit(content, widthPx, heightPx, style = {}) {
  const s = String(content ?? '');
  if (!s) return { keep: '', spill: '' };
  return splitRichToFitStatic(s, widthPx, heightPx, style);
}

/**
 * Paginate rich/plain letter content into page-sized chunks.
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{ fontSize?: number, lineHeight?: number, padding?: string }} [style]
 * @returns {string[]}
 */
export function paginateRich(content, widthPx, heightPx, style = {}) {
  const pages = [];
  let rest = String(content ?? '');
  let guard = 0;
  while (guard++ < 200) {
    if (!rest) {
      pages.push('');
      break;
    }
    const { keep, spill } = splitRichToFit(rest, widthPx, heightPx, style);
    pages.push(keep);
    if (!spill) break;
    rest = spill;
  }
  if (!pages.length) pages.push('');
  return pages;
}

/**
 * Mount Quill on a host element (replaces textarea hosts).
 * @param {HTMLElement} hostEl
 * @param {{
 *   placeholder?: string,
 *   onChange?: (html: string, meta?: { delta?: object, oldDelta?: object, source?: string }) => void,
 *   onFocus?: () => void,
 *   className?: string,
 *   fixJustifyCaret?: boolean,
 * }} [opts]
 */
/**
 * Map a client click through CSS `--page-scale` into a point suitable for
 * caretRangeFromPoint. The diary wrapper uses transform:scale with origin
 * top left; hit-testing often uses unscaled layout coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLElement} editorRoot
 * @returns {{ x: number, y: number }}
 */
function scaledClientToLayoutPoint(clientX, clientY, editorRoot) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--page-scale').trim();
  const scale = parseFloat(raw);
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.001) {
    return { x: clientX, y: clientY };
  }
  const wrap = editorRoot.closest('.editor-wrapper') || editorRoot;
  const visual = wrap.getBoundingClientRect();
  // Visual offset → layout offset (origin top left on .editor-wrapper).
  const layoutX = (clientX - visual.left) / scale;
  const layoutY = (clientY - visual.top) / scale;
  // caretRangeFromPoint expects client coords; project layout back as if the
  // unscaled box shared the same top-left as the visual box.
  return { x: visual.left + layoutX, y: visual.top + layoutY };
}

/**
 * Quill index nearest a client click (accounts for --page-scale).
 * @param {import('quill').default} quill
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number | null}
 */
export function quillIndexFromClientPoint(quill, clientX, clientY) {
  if (!quill?.root) return null;
  const { x, y } = scaledClientToLayoutPoint(clientX, clientY, quill.root);
  let domRange = null;
  if (typeof document.caretRangeFromPoint === 'function') {
    domRange = document.caretRangeFromPoint(x, y);
  } else if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos?.offsetNode) {
      domRange = document.createRange();
      domRange.setStart(pos.offsetNode, pos.offset);
      domRange.collapse(true);
    }
  }
  if (!domRange || !quill.root.contains(domRange.startContainer)) return null;
  try {
    const blot = Quill.find(domRange.startContainer, true);
    if (!blot) return null;
    const max = Math.max(0, quill.getLength() - 1);
    return Math.max(0, Math.min(quill.getIndex(blot) + (domRange.startOffset || 0), max));
  } catch {
    return null;
  }
}

export function mountQuill(hostEl, opts = {}) {
  const Quill = getQuillCtor();
  hostEl.innerHTML = '';
  if (opts.className) hostEl.classList.add(...opts.className.split(/\s+/).filter(Boolean));

  const quill = new Quill(hostEl, {
    theme: 'snow',
    placeholder: opts.placeholder || '',
    modules: {
      toolbar: false,
      // Document-level undo lives on diary/letter sheets; Quill History dies
      // with continuous-right remounts and records silent pager probes.
      history: false,
      clipboard: {
        matchVisual: false,
      },
    },
    formats: ['bold', 'italic', 'underline', 'align', 'list', 'image'],
  });

  // Snow theme may inject an empty toolbar as a previous sibling — remove it
  const prev = hostEl.previousElementSibling;
  if (prev?.classList?.contains('ql-toolbar')) prev.remove();
  hostEl.querySelector('.ql-toolbar')?.remove();

  hostEl.classList.add('bp-ql-container', 'ql-container');
  quill.root.classList.add('bp-ql-editor', 'hinglish-input');

  // Quill scrolls every ancestor overflow box (and the window) on selection
  // changes via scrollRectIntoView. Diary/letter pages are taller than the
  // viewport — that jumps the stage on caret restore. Caret stays put; the
  // user scrolls explicitly.
  quill.scrollSelectionIntoView = () => {};

  const api = {
    quill,
    host: hostEl,
    // Live model / reflow must keep blank paragraphs — collapsing them to ''
    // makes spill/collapse think the page is empty. A Quill that only holds
    // the default trailing newline (getLength() === 1) is truly empty.
    getHtml: () => {
      if (Math.max(0, quill.getLength() - 1) === 0 && !quill.root.querySelector('img')) {
        return '';
      }
      return getQuillHtmlPreservingBlanks(quill);
    },
    /** Collapsed HTML for "has user content?" checks — not for reflow. */
    getHtmlCollapsed: () => getQuillHtml(quill),
    getText: () => (quill.getText() || '').replace(/\n$/, ''),
    setContent: (content) => setQuillContent(quill, content),
    insertText(index, text) {
      quill.insertText(index, text, 'user');
      quill.setSelection(index + text.length, 0, 'user');
    },
    getQuill: () => quill,
    fitsInBox: () => editorFits(quill),
    destroy() {
      if (activeQuill === quill) setActiveQuill(null);
      quillByHost.delete(hostEl);
      fieldByEditor.delete(quill.root);
      hostEl.innerHTML = '';
    },
  };

  quill.on('text-change', (_delta, _old, source) => {
    if (source === 'silent') return;
    const html = Math.max(0, quill.getLength() - 1) === 0 && !quill.root.querySelector('img')
      ? ''
      : getQuillHtmlPreservingBlanks(quill);
    opts.onChange?.(html, {
      delta: _delta,
      oldDelta: _old,
      source,
    });
  });

  quill.on('selection-change', (range) => {
    if (range) {
      setActiveQuill(quill);
      syncToolbarUi();
      opts.onFocus?.();
    }
  });

  quill.root.addEventListener('focus', () => {
    setActiveQuill(quill);
    opts.onFocus?.();
  });

  quill.root.addEventListener('blur', () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        toolbarEl?.contains(active)
        || (active instanceof HTMLElement && active.classList.contains('ql-editor'))
      ) {
        return;
      }
      if (activeQuill === quill) setActiveQuill(null);
    });
  });

  if (opts.fixJustifyCaret) {
    quill.root.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const block = target.closest?.('p, li, div');
      if (!block || !quill.root.contains(block)) return;
      const justified = block.classList.contains('ql-align-justify')
        || /text-align\s*:\s*justify/i.test(block.getAttribute('style') || '');
      if (!justified) return;

      // CSS transform:scale on #editorScale means caretRangeFromPoint can miss
      // under scaled preview. Map the click into layout space of the wrapper.
      const { x, y } = scaledClientToLayoutPoint(e.clientX, e.clientY, quill.root);

      let domRange = null;
      if (typeof document.caretRangeFromPoint === 'function') {
        domRange = document.caretRangeFromPoint(x, y);
      } else if (typeof document.caretPositionFromPoint === 'function') {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos?.offsetNode) {
          domRange = document.createRange();
          domRange.setStart(pos.offsetNode, pos.offset);
          domRange.collapse(true);
        }
      }
      if (!domRange || !quill.root.contains(domRange.startContainer)) return;

      try {
        const blot = Quill.find(domRange.startContainer, true);
        if (!blot) return;
        let index = quill.getIndex(blot) + (domRange.startOffset || 0);
        const max = Math.max(0, quill.getLength() - 1);
        index = Math.max(0, Math.min(index, max));
        e.preventDefault();
        quill.setSelection(index, 0, 'user');
      } catch (_) {
        /* keep default Quill hit-testing */
      }
    });
  }

  quillByHost.set(hostEl, api);
  fieldByEditor.set(quill.root, api);
  return api;
}
