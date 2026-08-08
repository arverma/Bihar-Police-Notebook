/**
 * Platform-routed document export:
 *   desktop / Android → native browser print (print-document iframe)
 *   iOS / iPadOS      → raster A4 PDF (avoids WebKit clip)
 */

import { triggerNativePrint } from './print-document.js';
import { generateRasterPdf, deliverPdfBlob } from './raster-pdf.js';

/**
 * Detect iPhone / iPad / iPod, including iPadOS desktop-mode Safari.
 * Does NOT use viewport width — macOS Safari and Android stay on native print.
 *
 * @param {string} [ua]
 * @param {{ maxTouchPoints?: number, platform?: string }} [nav]
 * @returns {boolean}
 */
export function shouldUseRasterPdf(ua, nav) {
  const agent = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const touchPoints = Number(
    nav?.maxTouchPoints
      ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0),
  ) || 0;
  const platform = nav?.platform
    ?? (typeof navigator !== 'undefined' ? navigator.platform : '');

  if (/Android/i.test(agent)) return false;
  if (/iPhone|iPod|iPad/i.test(agent)) return true;
  // iPadOS 13+ desktop mode reports as Macintosh / MacIntel with touch points.
  if ((/Macintosh/i.test(agent) || platform === 'MacIntel') && touchPoints > 1) {
    return true;
  }
  return false;
}

/**
 * @typedef {'native-print'|'raster-pdf'} ExportMode
 */

/**
 * Resolve export mode. Explicit override wins (tests / forced raster path).
 * @param {{ mode?: ExportMode | null, ua?: string, nav?: { maxTouchPoints?: number, platform?: string } }} [opts]
 * @returns {ExportMode}
 */
export function resolveExportMode(opts = {}) {
  if (opts.mode === 'native-print' || opts.mode === 'raster-pdf') {
    return opts.mode;
  }
  return shouldUseRasterPdf(opts.ua, opts.nav) ? 'raster-pdf' : 'native-print';
}

/**
 * @typedef {object} RunDocumentExportDeps
 * @property {'diary'|'letter'} template
 * @property {string} [filename]
 * @property {ExportMode | null} [mode]
 * @property {string} [ua]
 * @property {{ maxTouchPoints?: number, platform?: string }} [nav]
 * @property {(template: 'diary'|'letter') => Promise<'ok'|'empty'>} [nativePrint]
 * @property {(opts: { template: 'diary'|'letter', filename: string, title?: string }) => Promise<{ blob: Blob, filename: string, pageCount: number }>} [rasterPdf]
 * @property {(blob: Blob, filename: string, opts?: object) => Promise<string> | string} [deliver]
 * @property {number} [timeoutMs] abort generation instead of hanging silently
 * @property {(msg: string) => void} [alert]
 */

/**
 * Run platform-routed document export.
 * @param {RunDocumentExportDeps} deps
 * @returns {Promise<'ok'|'empty'|'error'>}
 */
export async function runDocumentExport(deps) {
  const {
    template,
    filename = 'Document',
    mode = null,
    ua,
    nav,
    nativePrint = triggerNativePrint,
    rasterPdf = generateRasterPdf,
    deliver = deliverPdfBlob,
    timeoutMs = 60_000,
    alert: alertFn = (msg) => { window.alert(msg); },
  } = deps;

  const exportMode = resolveExportMode({ mode, ua, nav });

  if (exportMode === 'native-print') {
    const result = await nativePrint(template);
    if (result === 'empty') {
      alertFn('Cannot export empty document!');
      return 'empty';
    }
    return 'ok';
  }

  // Deliberately no pre-opened tab: on iOS that backgrounds the editor tab and
  // throttles the rendering the rasterizer depends on.
  try {
    const generated = await withTimeout(
      rasterPdf({ template, filename, title: filename }),
      timeoutMs,
      'timeout',
    );
    await deliver(generated.blob, generated.filename);
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'empty') {
      alertFn('Cannot export empty document!');
      return 'empty';
    }
    console.error('[document-export] raster PDF failed', err);
    alertFn(message === 'timeout'
      ? 'PDF is taking too long. Keep this tab open and try again.'
      : 'Could not create PDF. Please try again.');
    return 'error';
  }
}

/**
 * Reject rather than hang: a throttled or suspended tab can leave rendering
 * promises pending forever, which would leave the user with no feedback.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} reason
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, reason) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
