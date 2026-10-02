/**
 * Letter sheet: plain A4 pages that flow as one paged document editor.
 */
import { createDocSheet } from './editor/doc-sheet.js';

/**
 * @param {HTMLElement} container
 * @param {import('./editor/doc-sheet.js').SheetHooks} hooks
 */
export function initLetterSheet(container, hooks) {
  return createDocSheet(container, 'letter', hooks);
}
