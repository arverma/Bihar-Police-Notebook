/**
 * Quill 2 helpers for letter pages + diary right column.
 * Expects window.Quill from the CDN script in index.html.
 */

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
  const walk = (node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Quill getSemanticHTML() replaces every space with &nbsp;, which
        // prevents soft wrapping under white-space:normal. Normalize to U+0020.
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
            .filter((c) => /^ql-align-/.test(c) || c === 'ql-cursor');
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
      const cur = activeQuill.getFormat().align;
      activeQuill.format('align', cur === v || (v === 'left' && !cur) ? false : v === 'left' ? false : v);
      syncToolbarUi();
      return;
    }
    if (cmd === 'list') {
      const cur = activeQuill.getFormat().list;
      activeQuill.format('list', cur === 'bullet' ? false : 'bullet');
      syncToolbarUi();
      return;
    }
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') {
      const cur = Boolean(activeQuill.getFormat()[cmd]);
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

function syncToolbarUi() {
  if (!toolbarEl) return;
  const fmt = activeQuill ? activeQuill.getFormat() : {};
  toolbarEl.querySelectorAll('[data-ql]').forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const cmd = btn.dataset.ql || '';
    let on = false;
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') on = Boolean(fmt[cmd]);
    else if (cmd === 'list') on = fmt.list === 'bullet';
    else if (cmd.startsWith('align:')) {
      const v = cmd.slice(6);
      on = v === 'left' ? !fmt.align : fmt.align === v;
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
      quill.clipboard.dangerouslyPasteHTML(0, clean || '', 'silent');
    }
    // Drop trailing selection noise
    const len = quill.getLength();
    if (len > 0) quill.setSelection(Math.min(len - 1, len), 0, 'silent');
  };
  silent();
}

/**
 * @param {object} quill
 * @returns {string}
 */
export function getQuillHtml(quill) {
  const plain = (quill.getText() || '').replace(/\n$/, '');
  if (!plain.trim() && !quill.root.querySelector('img')) return '';
  let html = '';
  try {
    html = typeof quill.getSemanticHTML === 'function'
      ? quill.getSemanticHTML()
      : quill.root.innerHTML;
  } catch (_) {
    html = quill.root.innerHTML;
  }
  const clean = sanitizeQuillHtml(html);
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

/**
 * Offscreen Quill used for spill measurement.
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{ fontSize?: number, lineHeight?: number, padding?: string }} [style]
 */
function createMirrorQuill(widthPx, heightPx, style = {}) {
  const Quill = getQuillCtor();
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    `width:${widthPx}px`,
  ].join(';');
  const mount = document.createElement('div');
  host.appendChild(mount);
  document.body.appendChild(host);
  const quill = new Quill(mount, {
    theme: 'snow',
    modules: { toolbar: false },
    readOnly: true,
  });
  const root = quill.root;
  const pad = style.padding ?? '0';
  root.style.cssText = [
    `width:${widthPx}px`,
    `height:${heightPx}px`,
    `max-height:${heightPx}px`,
    'overflow:hidden',
    'box-sizing:border-box',
    `padding:${pad}`,
    `font-size:${style.fontSize ?? 16}px`,
    `line-height:${style.lineHeight ?? 24}px`,
    "font-family:'Noto Sans Devanagari', Arial, sans-serif",
    'border:none',
    'margin:0',
  ].join(';');
  const container = mount.querySelector('.ql-container');
  if (container instanceof HTMLElement) {
    container.style.border = 'none';
    container.style.height = `${heightPx}px`;
  }
  const toolbar = mount.querySelector('.ql-toolbar');
  toolbar?.remove();
  return {
    quill,
    destroy() {
      host.remove();
    },
  };
}

function editorFits(quill) {
  const root = quill.root;
  return root.scrollHeight <= root.clientHeight + 1;
}

/**
 * Split rich/plain content to fit a fixed box. Returns HTML/plain keep+spill.
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{ fontSize?: number, lineHeight?: number, padding?: string }} [style]
 * @returns {{ keep: string, spill: string }}
 */
export function splitRichToFit(content, widthPx, heightPx, style = {}) {
  const s = String(content ?? '');
  if (!s) return { keep: '', spill: '' };

  const mirror = createMirrorQuill(widthPx, heightPx, style);
  try {
    setQuillContent(mirror.quill, s);
    if (editorFits(mirror.quill)) {
      return { keep: isPlainDocContent(s) ? s : getQuillHtml(mirror.quill) || s, spill: '' };
    }

    const fullDelta = mirror.quill.getContents();
    const fullLen = Math.max(0, mirror.quill.getLength() - 1);
    const fullText = mirror.quill.getText().slice(0, fullLen);

    let lo = 0;
    let hi = fullLen;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      mirror.quill.setContents(fullDelta.slice(0, mid), 'silent');
      if (editorFits(mirror.quill)) lo = mid;
      else hi = mid - 1;
    }

    let cut = lo;
    const lookNl = fullText.lastIndexOf('\n', cut);
    if (lookNl >= Math.floor(cut * 0.5)) {
      cut = lookNl + 1;
    } else {
      const lookSp = fullText.lastIndexOf(' ', cut);
      if (lookSp > cut * 0.6) cut = lookSp + 1;
    }

    mirror.quill.setContents(fullDelta.slice(0, cut), 'silent');
    while (cut > 0 && !editorFits(mirror.quill)) {
      const prev = Math.max(
        fullText.lastIndexOf('\n', cut - 2),
        fullText.lastIndexOf(' ', cut - 2),
      );
      cut = prev > 0 ? prev + 1 : cut - 1;
      mirror.quill.setContents(fullDelta.slice(0, cut), 'silent');
    }

    const keepHtml = getQuillHtml(mirror.quill);
    mirror.quill.setContents(fullDelta.slice(cut), 'silent');
    const spillHtml = getQuillHtml(mirror.quill);

    // Prefer plain join when original was plain and no embeds
    if (isPlainDocContent(s) && !/<img\b/i.test(keepHtml + spillHtml)) {
      return {
        keep: fullText.slice(0, cut),
        spill: fullText.slice(cut),
      };
    }
    return { keep: keepHtml, spill: spillHtml };
  } finally {
    mirror.destroy();
  }
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
 *   onChange?: (html: string) => void,
 *   onFocus?: () => void,
 *   className?: string,
 * }} [opts]
 */
export function mountQuill(hostEl, opts = {}) {
  const Quill = getQuillCtor();
  hostEl.innerHTML = '';
  if (opts.className) hostEl.classList.add(...opts.className.split(/\s+/).filter(Boolean));

  const quill = new Quill(hostEl, {
    theme: 'snow',
    placeholder: opts.placeholder || '',
    modules: {
      toolbar: false,
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

  const api = {
    quill,
    host: hostEl,
    getHtml: () => getQuillHtml(quill),
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
    opts.onChange?.(getQuillHtml(quill));
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

  quillByHost.set(hostEl, api);
  fieldByEditor.set(quill.root, api);
  return api;
}
