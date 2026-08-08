/**
 * Client-side A4 PDF generation from print-clone page cards.
 * Used on iOS/iPadOS where WebKit print clips full-bleed A4 cards.
 *
 * Vendored libs (lazy-loaded on first use only):
 *   editor/vendor/html2canvas.min.js  (html2canvas 1.4.1)
 *   editor/vendor/jspdf.umd.min.js     (jsPDF 2.5.2)
 */

import { mountPrintCloneIframe } from './print-clone.js';

/** A4 portrait in PDF points (1 pt = 1/72 in). */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/** Fixed capture scale — avoid devicePixelRatio blow-up on Retina phones. */
export const CAPTURE_SCALE = 2;

/** JPEG quality for embedded page images. */
export const JPEG_QUALITY = 0.92;

/**
 * @param {string} relativePath path under editor/
 * @returns {string}
 */
function absUrl(relativePath) {
  return new URL(relativePath, window.location.href).href;
}

/**
 * Lazy-load a classic script once.
 * @param {string} src
 * @param {string} markerAttr
 * @returns {Promise<void>}
 */
function loadScriptOnce(src, markerAttr) {
  if (document.querySelector(`script[${markerAttr}]`)) {
    const existing = document.querySelector(`script[${markerAttr}]`);
    if (existing?.dataset.loaded === '1') return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing?.addEventListener('load', () => resolve(), { once: true });
      existing?.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(markerAttr, '1');
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * @typedef {object} ClientPdfLibs
 * @property {(el: HTMLElement, opts?: object) => Promise<HTMLCanvasElement>} html2canvas
 * @property {new (opts?: object) => {
 *   internal: { pageSize: { getWidth: () => number, getHeight: () => number } },
 *   addImage: (...args: any[]) => void,
 *   addPage: (...args: any[]) => void,
 *   setProperties: (props: object) => void,
 *   output: (type: string) => Blob,
 * }} jsPDF
 */

/**
 * Load vendored html2canvas + jsPDF (or use injected adapters in tests).
 * @param {Partial<ClientPdfLibs>} [inject]
 * @returns {Promise<ClientPdfLibs>}
 */
export async function loadClientPdfLibs(inject = {}) {
  if (inject.html2canvas && inject.jsPDF) {
    return /** @type {ClientPdfLibs} */ (inject);
  }

  await loadScriptOnce(absUrl('vendor/html2canvas.min.js'), 'data-bp-html2canvas');
  await loadScriptOnce(absUrl('vendor/jspdf.umd.min.js'), 'data-bp-jspdf');

  const html2canvas = inject.html2canvas || window.html2canvas;
  const jsPDF = inject.jsPDF || window.jspdf?.jsPDF;
  if (typeof html2canvas !== 'function') {
    throw new Error('html2canvas failed to load');
  }
  if (typeof jsPDF !== 'function') {
    throw new Error('jsPDF failed to load');
  }
  return { html2canvas, jsPDF };
}

/**
 * Normalize a document name into a safe .pdf filename.
 * @param {string} name
 * @returns {string}
 */
export function normalizePdfFilename(name) {
  let base = String(name || '').trim() || 'Document';
  // Strip path separators and control chars
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
  base = base.replace(/\s+\./g, '.');
  if (!/\.pdf$/i.test(base)) base = `${base}.pdf`;
  return base;
}

/**
 * Zero and discard a canvas to help iOS reclaim memory.
 * @param {HTMLCanvasElement | null | undefined} canvas
 */
function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  } catch (_) { /* ignore */ }
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * @typedef {object} GenerateClientPdfOptions
 * @property {'diary'|'letter'} template
 * @property {string} [filename]
 * @property {string} [title]
 * @property {Partial<ClientPdfLibs>} [libs]
 * @property {(template: 'diary'|'letter', options?: object) => Promise<import('./print-clone.js').MountedPrintClone | null>} [mount]
 * @property {typeof CAPTURE_SCALE} [scale]
 * @property {typeof JPEG_QUALITY} [quality]
 */

/**
 * Inject a classic script into a document and wait for load.
 * @param {Document} doc
 * @param {string} src
 * @param {string} markerAttr
 * @returns {Promise<void>}
 */
function injectScriptIntoDocument(doc, src, markerAttr) {
  if (doc.querySelector(`script[${markerAttr}]`)) {
    const existing = doc.querySelector(`script[${markerAttr}]`);
    if (existing?.dataset.loaded === '1') return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing?.addEventListener('load', () => resolve(), { once: true });
      existing?.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(markerAttr, '1');
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    doc.head.appendChild(script);
  });
}

/**
 * Build an A4 PDF blob from live print-clone page cards.
 * @param {GenerateClientPdfOptions} options
 * @returns {Promise<{ blob: Blob, filename: string, pageCount: number }>}
 */
export async function generateClientPdf(options) {
  const {
    template,
    filename: rawName = 'Document',
    title = rawName,
    libs: injectLibs,
    mount = mountPrintCloneIframe,
    scale = CAPTURE_SCALE,
    quality = JPEG_QUALITY,
  } = options;

  const filename = normalizePdfFilename(rawName);
  const libs = await loadClientPdfLibs(injectLibs || {});

  const mounted = await mount(template, { title: filename });
  if (!mounted || !mounted.pageEls.length) {
    mounted?.cleanup();
    throw new Error('empty');
  }

  // Bring iframe into the layout viewport (still invisible) so rasterizers
  // see real geometry; keep aria-hidden so it does not steal focus.
  const prevFrameCss = mounted.frame?.style?.cssText ?? '';
  if (mounted.frame?.style) {
    mounted.frame.style.cssText =
      'position:fixed;left:0;top:0;width:210mm;height:4000px;border:0;opacity:0;pointer-events:none;z-index:-1;';
  }
  try {
    const { jsPDF } = libs;
    /** @type {(el: HTMLElement, opts?: object) => Promise<HTMLCanvasElement>} */
    let html2canvasFn = libs.html2canvas;

    // Prefer capturing from inside the iframe window so clone CSS applies.
    if (!injectLibs?.html2canvas && mounted.win && mounted.doc) {
      await injectScriptIntoDocument(
        mounted.doc,
        absUrl('vendor/html2canvas.min.js'),
        'data-bp-html2canvas',
      );
      if (typeof mounted.win.html2canvas === 'function') {
        html2canvasFn = mounted.win.html2canvas.bind(mounted.win);
      }
    }

    /** @type {InstanceType<ClientPdfLibs['jsPDF']> | null} */
    let pdf = null;

    for (let i = 0; i < mounted.pageEls.length; i++) {
      const pageEl = mounted.pageEls[i];
      void pageEl.offsetHeight;
      const canvas = await html2canvasFn(pageEl, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 5000,
        width: pageEl.offsetWidth || undefined,
        height: pageEl.offsetHeight || undefined,
      });

      const imgData = canvas.toDataURL('image/jpeg', quality);
      if (!pdf) {
        pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'pt',
          format: [A4_WIDTH_PT, A4_HEIGHT_PT],
          compress: true,
        });
        pdf.setProperties({
          title: String(title || filename),
          creator: 'Bihar Police Notebook',
        });
      } else {
        pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT], 'portrait');
      }

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
      releaseCanvas(canvas);
    }

    if (!pdf) {
      throw new Error('empty');
    }

    const blob = pdf.output('blob');
    return {
      blob,
      filename,
      pageCount: mounted.pageCount,
    };
  } finally {
    if (mounted.frame?.style) {
      try { mounted.frame.style.cssText = prevFrameCss; } catch (_) { /* ignore */ }
    }
    mounted.cleanup();
  }
}
/**
 * Deliver a PDF blob: prefer opening in a reserved window, else download.
 * Callers on iOS should pass a window opened synchronously before awaiting generation.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @param {{ previewWindow?: Window | null, revokeDelayMs?: number }} [opts]
 * @returns {'preview'|'download'}
 */
export function deliverPdfBlob(blob, filename, opts = {}) {
  const url = URL.createObjectURL(blob);
  const revokeDelay = opts.revokeDelayMs ?? 60_000;
  const preview = opts.previewWindow;

  const revokeLater = () => {
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }, revokeDelay);
  };

  if (preview && !preview.closed) {
    try {
      preview.location.href = url;
      revokeLater();
      return 'preview';
    } catch (_) {
      try { preview.close(); } catch (__) { /* ignore */ }
    }
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  revokeLater();
  return 'download';
}
