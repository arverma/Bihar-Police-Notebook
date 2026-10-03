/**
 * Word (.docx) export: run the exporter, hand the file to the user, and
 * report anything that was simplified.
 *
 * Kept apart from router.js on purpose: the PDF paths there are tuned per
 * platform and untouched by this. The exporter itself (and the ~400 KB `docx`
 * bundle) is imported only when a Word export is first requested.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** File name safe on Windows/macOS/Linux, without extension. */
export function safeDocxName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.docx$/i, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
    .trim();
  return `${cleaned || 'Document'}.docx`;
}

/**
 * Save `blob` as `filename`. iOS/iPadOS Safari ignores `download` on blob
 * links, so there the native share sheet (Save to Files, Pages, Mail) is used
 * when it can carry a file.
 * @returns {Promise<'share'|'download'>}
 */
export async function deliverDocxBlob(blob, filename, { share = true, revokeDelayMs = 60_000 } = {}) {
  if (share && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
    try {
      const file = new File([blob], filename, { type: DOCX_MIME });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'share';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'share';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, revokeDelayMs);
  return 'download';
}

/**
 * @typedef {object} RunDocxExportDeps
 * @property {() => object} getJSON editor document JSON
 * @property {() => boolean} hasContent false for a blank document
 * @property {string} [filename] document name, without extension
 * @property {(json: object) => Promise<{ blob: Blob, warnings: string[] }>} [build]
 * @property {(blob: Blob, filename: string) => Promise<unknown> | unknown} [deliver]
 * @property {(msg: string) => void} [alert]
 */

/**
 * @param {RunDocxExportDeps} deps
 * @returns {Promise<'ok'|'empty'|'error'>}
 */
export async function runDocxExport(deps) {
  const {
    getJSON,
    hasContent,
    filename = 'Document',
    build = async (json) => (await import('./docx/build.js')).buildDocx(json),
    deliver = deliverDocxBlob,
    alert: alertFn = (msg) => { window.alert(msg); },
  } = deps;

  if (!hasContent()) {
    alertFn('Cannot export empty document!');
    return 'empty';
  }
  try {
    const { blob, warnings } = await build(getJSON());
    await deliver(blob, safeDocxName(filename));
    if (warnings.length) {
      alertFn(`Word file saved. Some content was simplified:\n- ${warnings.join('\n- ')}`);
    }
    return 'ok';
  } catch (err) {
    console.error('[docx-export] failed', err);
    alertFn('Could not create the Word file. Please try again.');
    return 'error';
  }
}
