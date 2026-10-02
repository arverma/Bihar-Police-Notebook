/**
 * Build a sanitized A4 print document from live page cards so PDF wrapping
 * matches the editor. Screen chrome is stripped, header controls become
 * static spans, and the writing cells keep their live HTML — the same
 * stylesheets lay them out, so every line breaks where it does on screen.
 */

export const PRINT_IFRAME_ID = 'bp-print-iframe';
const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;700&display=swap';

/**
 * Extra CSS for the print popup (live page cards already include page padding).
 */
export function printDocumentExtraCss() {
  return `
    @page {
      size: A4;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      /* WebKit inflates fonts in blocks wider than the device viewport; the
         clone is a fixed 210mm sheet, so boosting must be off. */
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
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
    .print-pages .letter-page-chrome {
      display: none !important;
    }
    /* Screen-only page footer; raster PDF renders screen media, so drop it here. */
    .print-pages .bp-page::after {
      content: none !important;
    }
    .print-pages .bp-cell {
      color: #000;
    }
    /* Static replacement for the titles-row input keeps its own line (the live
       rule targets input, which no longer matches after flattening). */
    .print-pages .fir-table th.right-column .print-static {
      display: block;
      width: 48px;
      margin: 4px auto 0;
      text-align: center;
      font-size: 12px;
      font-weight: 400;
      border-bottom: 1px dotted #333;
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
  `;
}

/**
 * @param {string} relativePath path under editor/ (e.g. css/editor.css)
 * @returns {string}
 */
function absUrl(relativePath) {
  return new URL(relativePath, window.location.href).href;
}

/**
 * Stylesheet links shared with the live editor.
 * @returns {string}
 */
export function printDocumentStylesheetLinks() {
  // Same stylesheets that lay out the live pages.
  return [
    `<link rel="stylesheet" href="${FONT_LINK}">`,
    `<link rel="stylesheet" href="${absUrl('css/tokens.css')}">`,
    `<link rel="stylesheet" href="${absUrl('css/editor.css')}">`,
    `<link rel="stylesheet" href="${absUrl('css/doc-editor.css')}">`,
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
 * Turn cloned writing cells into static text: no editing affordances, no
 * placeholder or pager state. Blank lines keep their <br> so they print.
 * @param {HTMLElement} pageEl
 */
function flattenEditorCells(pageEl) {
  pageEl.querySelectorAll('.bp-cell').forEach((cell) => {
    cell.removeAttribute('data-overflow');
    cell.querySelectorAll('.is-empty').forEach((p) => {
      p.classList.remove('is-empty');
      p.removeAttribute('data-placeholder');
    });
  });
  pageEl.querySelectorAll('[contenteditable]').forEach((el) => {
    if (!el.matches('[data-field]')) el.removeAttribute('contenteditable');
  });
}

/**
 * Sanitize one cloned diary or letter page for print.
 * @param {HTMLElement} pageEl
 * @returns {HTMLElement}
 */
export function sanitizeExportPage(pageEl) {
  pageEl.querySelectorAll('.screen-only').forEach((el) => el.remove());
  pageEl.querySelectorAll('.diary-page-chrome, .letter-page-chrome').forEach((el) => el.remove());
  flattenEditorCells(pageEl);

  // Header / titles controls → static spans
  pageEl.querySelectorAll(
    'input[data-field], textarea[data-field], [data-field].diary-dotted-flow, [data-field][contenteditable="true"]',
  ).forEach((el) => {
    if (el instanceof HTMLElement) replaceControlWithSpan(el);
  });
  return pageEl;
}

/**
 * Build print HTML body from live page cards.
 * @param {'diary'|'letter'} template
 * @returns {{ html: string, pageCount: number } | null}
 */
export function buildPrintDocumentHtml(template) {
  const wrapperSel = template === 'letter' ? '.editor-wrapper.editor-letter' : '.editor-wrapper.editor-diary';
  const pageSel = template === 'letter' ? '.letter-page' : '.diary-page';
  const wrapper = document.querySelector(wrapperSel);
  if (!wrapper) return null;

  const livePages = [...wrapper.querySelectorAll(pageSel)];
  if (!livePages.length) return null;

  const mount = document.createElement('div');
  mount.className = 'print-pages';

  // Carry the diary column ratio from the live pages
  const diaryPages = document.getElementById('diaryPages');
  if (diaryPages && template === 'diary') {
    const leftCol = getComputedStyle(diaryPages).getPropertyValue('--diary-left-col').trim();
    if (leftCol) mount.style.setProperty('--diary-left-col', leftCol);
  }

  livePages.forEach((live) => {
    const clone = /** @type {HTMLElement} */ (live.cloneNode(true));
    // Preserve measured box height CSS var
    const boxH = live.style.getPropertyValue('--diary-box-h');
    if (boxH) clone.style.setProperty('--diary-box-h', boxH);

    // Input values are not cloned by cloneNode — copy before sanitize replaces them
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

    sanitizeExportPage(clone);
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
 * Wait for stylesheets, fonts, and images in a print-document.
 * @param {Document} doc
 * @returns {Promise<void>}
 */
async function waitForPrintCloneReady(doc) {
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

  // Every wait below must be bounded: a throttled WebKit tab can leave font and
  // image promises permanently pending, which would hang export with no error.
  const capped = (promise, ms) => Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise((r) => setTimeout(r, ms)),
  ]);

  const fontSize = 16;
  try {
    if (doc.fonts?.load) {
      await capped(doc.fonts.load(`${fontSize}px "Noto Sans Devanagari"`), 3000);
      await capped(doc.fonts.load(`700 ${fontSize}px "Noto Sans Devanagari"`), 3000);
    }
    if (doc.fonts?.ready) {
      await capped(doc.fonts.ready, 5000);
    } else {
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (_) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const images = [...doc.images];
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
  }));

  void doc.body?.offsetHeight;
}

/**
 * @typedef {object} MountedPrintDocument
 * @property {HTMLIFrameElement} frame
 * @property {Document} doc
 * @property {Window} win
 * @property {number} pageCount
 * @property {HTMLElement[]} pageEls
 * @property {() => void} cleanup
 */

/**
 * Mount sanitized A4 page cards in an offscreen iframe (shared by native print + client PDF).
 * @param {'diary'|'letter'} template
 * @param {{ title?: string }} [options]
 * @returns {Promise<MountedPrintDocument | null>}
 */
export async function mountPrintDocument(template, options = {}) {
  const built = buildPrintDocumentHtml(template);
  if (!built || !built.html) return null;

  const existing = document.getElementById(PRINT_IFRAME_ID);
  if (existing) existing.remove();

  const frame = document.createElement('iframe');
  frame.id = PRINT_IFRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('scrolling', 'no');
  // Offscreen — never display:none / visibility:hidden (blank prints / blank captures).
  frame.style.cssText =
    'position:fixed;left:-20000px;top:0;width:210mm;height:4000px;border:0;overflow:hidden;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    removePrintIframe(frame);
    return null;
  }

  const title = options.title || 'Print Document';
  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=794">
      <title>${title.replace(/</g, '')}</title>
      ${printDocumentStylesheetLinks()}
      <style>${printDocumentExtraCss()}</style>
    </head>
    <body class="print-root">
      ${built.html}
    </body></html>`);
  doc.close();

  await waitForPrintCloneReady(doc);

  const contentH = doc.documentElement?.scrollHeight || 0;
  if (contentH > 0) {
    frame.style.height = `${contentH}px`;
  }

  const pageSel = template === 'letter' ? '.letter-page' : '.diary-page';
  // Do not use parent-window `instanceof HTMLElement` — iframe nodes fail that check.
  const pageEls = [...doc.querySelectorAll(pageSel)].filter(
    (el) => el && el.nodeType === 1,
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removePrintIframe(frame);
  };

  return {
    frame,
    doc,
    win,
    pageCount: built.pageCount,
    pageEls,
    cleanup,
  };
}

/**
 * Open a same-page print iframe with cloned pages and trigger print after styles/fonts load.
 * @param {'diary'|'letter'} template
 * @returns {Promise<'ok'|'empty'>}
 */
export async function triggerNativePrint(template) {
  const mounted = await mountPrintDocument(template);
  if (!mounted) return 'empty';

  const { win, cleanup } = mounted;
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
