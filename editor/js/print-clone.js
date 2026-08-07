/**
 * Clone live A4 page cards into a print iframe so PDF wrapping matches the editor.
 * Screen chrome is stripped; header controls become static spans; left column
 * stays a textarea (same wrap engine); Quill bodies keep live HTML (real spaces).
 */

const PRINT_IFRAME_ID = 'bp-print-iframe';

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;700&display=swap';
const QUILL_SNOW =
  'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css';

/**
 * Extra CSS for the print popup (live page cards already include page padding).
 */
export function printCloneExtraCss() {
  return `
    @page {
      size: A4;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    body.print-root {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .print-pages {
      display: block;
      width: 210mm;
      margin: 0;
      padding: 0;
    }
    .print-pages .diary-page,
    .print-pages .letter-page {
      box-shadow: none !important;
      margin: 0 !important;
      page-break-after: always;
      break-after: page;
    }
    .print-pages .diary-page:last-child,
    .print-pages .letter-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .print-pages .screen-only,
    .print-pages .diary-page-chrome,
    .print-pages .letter-page-chrome,
    .print-pages .ql-toolbar {
      display: none !important;
    }
    .print-pages .diary-box-overflow {
      outline: none !important;
    }
    .print-pages .bp-ql-editor.ql-blank::before,
    .print-pages .ql-editor.ql-blank::before {
      content: none !important;
      display: none !important;
    }
    .print-pages textarea.fir-input {
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: #000;
      -webkit-text-fill-color: #000;
    }
    .print-pages .diary-dotted.print-static {
      display: inline-block;
      border: none;
      border-bottom: 1px dotted #000;
      background: transparent;
      color: #000;
      vertical-align: baseline;
      box-sizing: content-box;
    }
    .print-pages .print-static-quill,
    .print-pages .bp-ql-editor.print-static-quill {
      white-space: pre-wrap;
      tab-size: 4;
      -moz-tab-size: 4;
      overflow-wrap: break-word;
      word-break: normal;
      overflow: hidden;
      box-sizing: border-box;
      color: #000;
    }
    .print-pages .print-static-quill-host {
      border: none !important;
      background: transparent;
    }
    .print-pages .diary-cell .print-static-quill-host {
      width: 100%;
      height: 100%;
    }
    .print-pages .diary-cell .print-static-quill {
      padding: 4px 6px;
      font-family: 'Noto Sans Devanagari', Arial, sans-serif;
      font-size: 16px;
      line-height: 24px;
      height: 100%;
      max-height: none;
      box-sizing: border-box;
    }
    .print-pages .letter-page .print-static-quill-host {
      width: 100%;
      height: 912px;
      max-height: 912px;
    }
    .print-pages .letter-page .print-static-quill {
      padding: 0;
      font-family: 'Noto Sans Devanagari', sans-serif;
      font-size: 16px;
      line-height: 24px;
      box-sizing: border-box;
    }
  `;
}

/**
 * @param {string} relativePath path under editor/ (e.g. css/style.css)
 * @returns {string}
 */
function absUrl(relativePath) {
  return new URL(relativePath, window.location.href).href;
}

/**
 * Stylesheet links shared with the live editor.
 * @returns {string}
 */
export function printCloneStylesheetLinks() {
  // Match editor/index.html order: app CSS first, Quill snow last.
  return [
    `<link rel="stylesheet" href="${FONT_LINK}">`,
    `<link rel="stylesheet" href="${absUrl('css/tokens.css')}">`,
    `<link rel="stylesheet" href="${absUrl('css/style.css')}">`,
    `<link rel="stylesheet" href="${QUILL_SNOW}">`,
  ].join('\n');
}

/**
 * Format YYYY-MM-DD date input value as dd/mm/yyyy for print.
 * @param {string} v
 * @returns {string}
 */
function formatDateForPrint(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

/**
 * Replace an input/contenteditable with a static span that keeps dotted styling.
 * @param {HTMLElement} el
 */
function replaceControlWithSpan(el) {
  const span = document.createElement('span');
  const classes = [...el.classList].filter((c) => c !== 'hinglish-input');
  span.className = [...classes, 'print-static'].join(' ');
  Object.keys(el.dataset).forEach((k) => {
    span.dataset[k] = el.dataset[k];
  });

  let text = '';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    text = el.type === 'date' ? formatDateForPrint(el.value) : (el.value || '');
  } else {
    text = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  if (text) {
    span.textContent = text;
  } else {
    span.innerHTML = '&nbsp;';
  }

  el.replaceWith(span);
}

/**
 * Flatten Quill host to a static editor tree (container + editor) without Quill JS.
 * Keeps the same nesting as the live page so column width matches.
 * @param {HTMLElement} pageEl
 */
function flattenQuillHosts(pageEl) {
  pageEl.querySelectorAll('.ql-container, .bp-ql-container').forEach((host) => {
    if (!(host instanceof HTMLElement)) return;
    const editor = host.querySelector('.ql-editor, .bp-ql-editor');
    if (!(editor instanceof HTMLElement)) return;

    const liveWidth = Number(editor.dataset.printW) || editor.clientWidth;
    const liveHeight = Number(editor.dataset.printH) || editor.clientHeight;

    const staticEditor = document.createElement('div');
    staticEditor.className = editor.className;
    staticEditor.classList.remove('ql-blank');
    staticEditor.classList.add('bp-ql-editor', 'ql-editor', 'print-static-quill');
    staticEditor.innerHTML = editor.innerHTML;
    staticEditor.querySelectorAll('.ql-cursor, .ql-ui').forEach((n) => n.remove());
    if (liveWidth > 0) staticEditor.style.width = `${liveWidth}px`;
    if (liveHeight > 0) {
      staticEditor.style.height = `${liveHeight}px`;
      staticEditor.style.maxHeight = `${liveHeight}px`;
    }

    // Replace host contents with static editor; drop Quill snow chrome classes that add borders
    host.classList.remove('ql-snow', 'ql-disabled');
    host.classList.add('print-static-quill-host');
    host.innerHTML = '';
    host.appendChild(staticEditor);
  });
  pageEl.querySelectorAll('.ql-toolbar').forEach((tb) => tb.remove());
}

/**
 * Sanitize one cloned diary or letter page for print.
 * @param {HTMLElement} pageEl
 * @returns {HTMLElement}
 */
export function sanitizePageClone(pageEl) {
  pageEl.querySelectorAll('.screen-only').forEach((el) => el.remove());
  pageEl.querySelectorAll('.diary-page-chrome, .letter-page-chrome').forEach((el) => el.remove());
  pageEl.classList.remove('diary-box-overflow');
  pageEl.querySelectorAll('.diary-box-overflow').forEach((el) => {
    el.classList.remove('diary-box-overflow');
  });

  // Flatten Quill first so the body is no longer contenteditable and cannot be
  // mistaken for a header flow field by the control-replacement selector.
  flattenQuillHosts(pageEl);

  // Header / titles controls → static spans (never Quill .ql-editor)
  pageEl.querySelectorAll(
    'input[data-field], textarea[data-field], [data-field].diary-dotted-flow, [data-field][contenteditable="true"]:not(.ql-editor):not(.bp-ql-editor)',
  ).forEach((el) => {
    if (el instanceof HTMLElement) replaceControlWithSpan(el);
  });

  // Left column: keep textarea, lock for print
  pageEl.querySelectorAll('textarea[data-col="left"], textarea.fir-input').forEach((ta) => {
    if (!(ta instanceof HTMLTextAreaElement)) return;
    ta.readOnly = true;
    ta.removeAttribute('placeholder');
    ta.setAttribute('tabindex', '-1');
    ta.spellcheck = false;
    const w = Number(ta.dataset.printW) || ta.clientWidth;
    const h = Number(ta.dataset.printH) || ta.clientHeight;
    if (w > 0) ta.style.width = `${w}px`;
    if (h > 0) ta.style.height = `${h}px`;
  });

  // Copy CSS variables from live page (box height, left col %)
  return pageEl;
}

/**
 * Build print HTML body from live page cards.
 * @param {'diary'|'letter'} template
 * @returns {{ html: string, pageCount: number } | null}
 */
export function buildPrintCloneBody(template) {
  const wrapperSel = template === 'letter' ? '.editor-wrapper.editor-letter' : '.editor-wrapper.editor-diary';
  const pageSel = template === 'letter' ? '.letter-page' : '.diary-page';
  const wrapper = document.querySelector(wrapperSel);
  if (!wrapper) return null;

  const livePages = [...wrapper.querySelectorAll(pageSel)];
  if (!livePages.length) return null;

  const mount = document.createElement('div');
  mount.className = 'print-pages';

  // Carry diary column ratio if set on #diaryPages
  const diaryPages = document.getElementById('diaryPages');
  if (diaryPages && template === 'diary') {
    const leftCol = diaryPages.style.getPropertyValue('--diary-left-col');
    if (leftCol) mount.style.setProperty('--diary-left-col', leftCol);
  }

  livePages.forEach((live) => {
    const clone = /** @type {HTMLElement} */ (live.cloneNode(true));
    // Preserve measured box height CSS var
    const boxH = live.style.getPropertyValue('--diary-box-h');
    if (boxH) clone.style.setProperty('--diary-box-h', boxH);

    // Measure live Quill editors before sanitize (clone is off-DOM → clientWidth 0)
    const liveEditors = live.querySelectorAll('.ql-editor, .bp-ql-editor');
    const cloneEditors = clone.querySelectorAll('.ql-editor, .bp-ql-editor');
    liveEditors.forEach((src, i) => {
      const dest = cloneEditors[i];
      if (src instanceof HTMLElement && dest instanceof HTMLElement) {
        if (src.clientWidth > 0) dest.dataset.printW = String(src.clientWidth);
        if (src.clientHeight > 0) dest.dataset.printH = String(src.clientHeight);
      }
    });

    // Textarea values / sizes — copy from live (cloneNode may drop .value)
    const liveTextareas = live.querySelectorAll('textarea');
    const cloneTextareas = clone.querySelectorAll('textarea');
    liveTextareas.forEach((src, i) => {
      const dest = cloneTextareas[i];
      if (src instanceof HTMLTextAreaElement && dest instanceof HTMLTextAreaElement) {
        dest.value = src.value;
        if (src.clientWidth > 0) dest.dataset.printW = String(src.clientWidth);
        if (src.clientHeight > 0) dest.dataset.printH = String(src.clientHeight);
      }
    });
    // Input values also need explicit copy before sanitize replaces them
    const liveInputs = live.querySelectorAll('input');
    const cloneInputs = clone.querySelectorAll('input');
    liveInputs.forEach((src, i) => {
      const dest = cloneInputs[i];
      if (src instanceof HTMLInputElement && dest instanceof HTMLInputElement) {
        dest.value = src.value;
        if (src.type === 'checkbox' || src.type === 'radio') {
          dest.checked = src.checked;
        }
      }
    });

    sanitizePageClone(clone);
    // Textarea .value is not serialized by outerHTML — put it in text content.
    clone.querySelectorAll('textarea').forEach((ta) => {
      if (ta instanceof HTMLTextAreaElement) {
        ta.textContent = ta.value;
        const w = ta.dataset.printW;
        const h = ta.dataset.printH;
        if (w) ta.style.width = `${w}px`;
        if (h) ta.style.height = `${h}px`;
        delete ta.dataset.printW;
        delete ta.dataset.printH;
      }
    });
    mount.appendChild(clone);
  });

  return { html: mount.outerHTML, pageCount: livePages.length };
}

/**
 * Remove the print iframe if it is still in the document.
 * @param {HTMLIFrameElement} frame
 */
function removePrintIframe(frame) {
  try {
    if (frame.isConnected) frame.remove();
  } catch (_) { /* ignore */ }
}

/**
 * Open a same-page print iframe with cloned pages and trigger print after styles/fonts load.
 * @param {'diary'|'letter'} template
 * @returns {Promise<'ok'|'empty'>}
 */
export async function openPrintCloneWindow(template) {
  const built = buildPrintCloneBody(template);
  if (!built || !built.html) return 'empty';

  const existing = document.getElementById(PRINT_IFRAME_ID);
  if (existing) existing.remove();

  const frame = document.createElement('iframe');
  frame.id = PRINT_IFRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('scrolling', 'no');
  // Offscreen — never display:none / visibility:hidden (blank prints).
  frame.style.cssText =
    'position:fixed;left:-20000px;top:0;width:210mm;height:4000px;border:0;overflow:hidden;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    removePrintIframe(frame);
    return 'empty';
  }

  const fontSize = 16;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Print Document</title>
      ${printCloneStylesheetLinks()}
      <style>${printCloneExtraCss()}</style>
    </head>
    <body class="print-root">
      ${built.html}
    </body></html>`);
  doc.close();

  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  await Promise.all(links.map((link) => new Promise((resolve) => {
    if (link.sheet) {
      resolve();
      return;
    }
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  })));

  try {
    if (doc.fonts?.load) {
      await doc.fonts.load(`${fontSize}px "Noto Sans Devanagari"`);
      await doc.fonts.load(`700 ${fontSize}px "Noto Sans Devanagari"`);
    }
    if (doc.fonts?.ready) {
      await doc.fonts.ready;
    } else {
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (_) {
    await new Promise((r) => setTimeout(r, 500));
  }

  void doc.body?.offsetHeight;
  const contentH = doc.documentElement?.scrollHeight || 0;
  if (contentH > 0) {
    frame.style.height = `${contentH}px`;
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removePrintIframe(frame);
  };

  win.addEventListener('afterprint', () => {
    setTimeout(cleanup, 500);
  }, { once: true });
  setTimeout(cleanup, 60_000);

  try {
    win.focus();
  } catch (_) { /* ignore */ }
  win.print();
  return 'ok';
}
