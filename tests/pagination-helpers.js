/**
 * Shared Playwright helpers for the paged editors.
 *
 * Everything reads document state through `window.__bpTest` (see
 * editor/js/editor/test-hooks.js), so an assertion never activates or
 * re-renders anything it is measuring.
 */

/**
 * Load the app with a clean store and wait for the editors.
 * @param {import('@playwright/test').Page} page
 */
export async function openFresh(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('bp-writing-tool');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__uxInitComplete === true && window.__bpTest);
  await settle(page);
}

/** Wait until pagination is idle. */
export async function settle(page, template) {
  await page.evaluate((t) => window.__bpTest.settle(t), template);
}

/**
 * Load a document and wait for it to paginate.
 * Diary: [{ left, right, hasHeader, fields }]; letter: [[blocks]].
 */
export async function setDoc(page, pages, template) {
  await page.evaluate(({ p, t }) => window.__bpTest.setDoc(p, t), { p: pages, t: template });
  await settle(page, template);
}

/** Logical blocks of a column across all pages (cut paragraphs re-joined). */
export async function columnBlocks(page, col = 'right', template) {
  return page.evaluate(({ c, t }) => window.__bpTest.blocks(c, t), { c: col, t: template });
}

/** Blocks per page of a column; '+' marks a continuation of a cut paragraph. */
export async function columnPages(page, col = 'right', template) {
  return page.evaluate(({ c, t }) => window.__bpTest.pages(c, t), { c: col, t: template });
}

export async function pageCount(page, template) {
  return page.evaluate((t) => window.__bpTest.pageCount(t), template);
}

/** @returns {Promise<{ page: number, col: string|null, text: string, offset: number, empty: boolean, focused: boolean }>} */
export async function caret(page, template) {
  return page.evaluate((t) => window.__bpTest.caret(t), template);
}

/**
 * Focus the editor with the caret in a cell (default: end of its last block).
 * @param {{ page?: number, col?: string, block?: number, offset?: number, start?: boolean }} where
 */
export async function setCaret(page, where, template) {
  await page.evaluate(({ w, t }) => window.__bpTest.setCaret(w, t), { w: where, t: template });
}

/** Writing boxes whose text is cut off by the box edge — must always be empty. */
export async function clippedBoxes(page, template) {
  return page.evaluate((t) => window.__bpTest.clipped(t), template);
}

/** Numbered one-line paragraphs: welding of any two shows up as "2930". */
export function numberedLines(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(String(i));
  return out;
}

/**
 * Leave the diary at exactly one page whose right column is `freeLines`
 * lines short of full, optionally ending in `lastLine`.
 * Overfill once, read how many one-line paragraphs the pager kept on page 1,
 * then load exactly that many.
 */
export async function fillSinglePage(page, { lastLine = null, freeLines = 0 } = {}) {
  await setDoc(page, [{ right: numberedLines(1, 80) }]);
  const capacity = (await columnPages(page, 'right'))[0].length;
  const lines = numberedLines(1, Math.max(1, capacity - freeLines));
  if (lastLine != null) lines[lines.length - 1] = lastLine;
  await setDoc(page, [{ right: lines }]);
  return capacity;
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function disableTranslit(page) {
  const toggle = page.locator('#translitToggle');
  if (await toggle.isChecked()) {
    await page.locator('.toggle-slider').click();
  }
}

/** Switch the visible template via the segment in the History panel. */
export async function switchTemplate(page, template) {
  const sidebar = page.locator('#sidebar');
  const wasOpen = await sidebar.evaluate((el) => el.classList.contains('open'));
  if (!wasOpen) await page.locator('.switch-btn').click();
  await page.locator(`#templateSegment [data-template="${template}"]`).click();
  if (!wasOpen) {
    await page.locator('.switch-btn').click();
    // Opening/closing History slides the panel and nudges the workspace.
    await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition)));
  }
  await page.waitForFunction(
    (t) => getComputedStyle(document.querySelector(`.editor-${t}`)).display !== 'none',
    template,
  );
  await settle(page, template);
}
