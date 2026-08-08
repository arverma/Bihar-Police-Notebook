/**
 * Platform-routed PDF export:
 *   desktop / Android → native browser print (print-clone iframe)
 *   iOS / iPadOS      → client-generated A4 PDF (avoids WebKit clip)
 */

import { openPrintCloneWindow } from './print-clone.js';
import { generateClientPdf, deliverPdfBlob } from './client-pdf.js';

/**
 * Detect iPhone / iPad / iPod, including iPadOS desktop-mode Safari.
 * Does NOT use viewport width — macOS Safari and Android stay on native print.
 *
 * @param {string} [ua]
 * @param {{ maxTouchPoints?: number, platform?: string }} [nav]
 * @returns {boolean}
 */
export function shouldUseClientPdf(ua, nav) {
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
 * @typedef {'native-print'|'client-pdf'} ExportMode
 */

/**
 * Resolve export mode. Explicit override wins (tests / forced client path).
 * @param {{ mode?: ExportMode | null, ua?: string, nav?: { maxTouchPoints?: number, platform?: string } }} [opts]
 * @returns {ExportMode}
 */
export function resolveExportMode(opts = {}) {
  if (opts.mode === 'native-print' || opts.mode === 'client-pdf') {
    return opts.mode;
  }
  return shouldUseClientPdf(opts.ua, opts.nav) ? 'client-pdf' : 'native-print';
}

/**
 * @typedef {object} RunPdfExportDeps
 * @property {'diary'|'letter'} template
 * @property {string} [filename]
 * @property {ExportMode | null} [mode]
 * @property {string} [ua]
 * @property {{ maxTouchPoints?: number, platform?: string }} [nav]
 * @property {(template: 'diary'|'letter') => Promise<'ok'|'empty'>} [nativePrint]
 * @property {(opts: { template: 'diary'|'letter', filename: string, title?: string }) => Promise<{ blob: Blob, filename: string, pageCount: number }>} [clientPdf]
 * @property {(blob: Blob, filename: string, opts?: object) => 'preview'|'download'} [deliver]
 * @property {() => Window | null} [openPreviewWindow]
 * @property {(msg: string) => void} [alert]
 */

/**
 * Run platform-routed PDF export.
 * @param {RunPdfExportDeps} deps
 * @returns {Promise<'ok'|'empty'|'error'>}
 */
export async function runPdfExport(deps) {
  const {
    template,
    filename = 'Document',
    mode = null,
    ua,
    nav,
    nativePrint = openPrintCloneWindow,
    clientPdf = generateClientPdf,
    deliver = deliverPdfBlob,
    openPreviewWindow = () => {
      try {
        return window.open('', '_blank');
      } catch (_) {
        return null;
      }
    },
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

  // Reserve a tab synchronously before any await (iOS popup blocker).
  let previewWindow = null;
  try {
    previewWindow = openPreviewWindow();
  } catch (_) {
    previewWindow = null;
  }

  try {
    const generated = await clientPdf({
      template,
      filename,
      title: filename,
    });
    deliver(generated.blob, generated.filename, { previewWindow });
    return 'ok';
  } catch (err) {
    try { previewWindow?.close(); } catch (_) { /* ignore */ }
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'empty') {
      alertFn('Cannot export empty document!');
      return 'empty';
    }
    console.error('[pdf-export] client PDF failed', err);
    alertFn('Could not create PDF. Please try again.');
    return 'error';
  }
}
