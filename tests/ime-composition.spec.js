import { test, expect } from '@playwright/test';
import {
  openFresh, setCaret, settle, columnBlocks, columnPages, clippedBoxes, caret, disableTranslit, fillSinglePage,
} from './pagination-helpers.js';

/**
 * IME composition at a page edge.
 *
 * Android keyboards (Gboard) and desktop Hindi IMEs compose most words: the
 * text is provisional until committed, and changing the document under an
 * active composition breaks it (lost or doubled characters). The pager must
 * hold still while a composition is open and reflow once it is committed.
 *
 * Driven through Chrome's own IME pipeline (CDP Input.imeSetComposition /
 * insertText), which produces real composition events — the closest an
 * automated test gets to a device keyboard. Re-check on a real Android phone.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP IME input is Chromium-only');

/** @param {import('@playwright/test').Page} page */
async function ime(page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    compose: (text) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }),
    commit: (text) => cdp.send('Input.insertText', { text }),
  };
}

test.describe('IME composition', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  test('a composition that overflows the page is not reflowed until it is committed', async ({ page }) => {
    const capacity = await fillSinglePage(page, { lastLine: 'अंतिम' });
    await setCaret(page, { page: 0, col: 'right' });
    const kb = await ime(page);
    const pagesOf = () => page.evaluate(() => window.__bpTest.pageCount());

    // Compose a long run on the last line: it wraps past the bottom edge while
    // still provisional. Moving it to page 2 now would break the composition.
    let composed = '';
    for (let i = 0; i < 12; i++) {
      composed += ' घटनास्थल';
      await kb.compose(composed);
      await page.waitForTimeout(50);
      expect(await pagesOf()).toBe(1);
    }
    expect(await page.evaluate(() => document.querySelector('.editor-diary .bp-doc').dataset.bpPager)).toBe('suspended');

    await kb.commit(composed);
    await settle(page);
    expect(await pagesOf()).toBe(2);
    const blocks = await columnBlocks(page);
    expect(blocks).toEqual([...Array.from({ length: capacity - 1 }, (_, i) => String(i + 1)), `अंतिम${composed}`]);
    const c = await caret(page);
    expect(c.page).toBe(1);
    expect(c.text.slice(0, c.offset).endsWith('घटनास्थल')).toBe(true);
    expect(c.offset).toBe(c.text.length);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('composing past the bottom edge spills once the word is committed', async ({ page }) => {
    await fillSinglePage(page, { lastLine: 'आखिरी पंक्ति' });
    await setCaret(page, { page: 0, col: 'right' });
    const kb = await ime(page);
    const words = ['जाँच', 'अधिकारी', 'घटनास्थल', 'पहुँचे', 'और', 'साक्ष्य', 'एकत्र', 'किए'];
    for (const w of words) {
      await kb.compose(w);
      await kb.commit(`${w} `);
    }
    await settle(page);
    const text = (await columnBlocks(page)).join('\n');
    expect(text).toContain(`आखिरी पंक्ति${words.map((w) => `${w} `).join('')}`);
    expect(await clippedBoxes(page)).toEqual([]);
    expect((await columnPages(page)).length).toBeGreaterThanOrEqual(1);
  });

  test('Backspace during a composition at the top of page 2 stays inside the composition', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await settle(page);
    const kb = await ime(page);
    await kb.compose('कम');
    await kb.compose('क');
    await kb.commit('क');
    await settle(page);
    const blocks = await columnBlocks(page);
    expect(blocks[capacity]).toBe('क');
    expect(blocks[capacity - 1]).toBe(String(capacity));
  });
});
