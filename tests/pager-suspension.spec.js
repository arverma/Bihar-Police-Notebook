import { test, expect } from '@playwright/test';
import { openFresh, setCaret, fillSinglePage, clippedBoxes } from './pagination-helpers.js';

/**
 * The pager pauses while a mouse button is down (a reflow would break a drag).
 * `mouseup` is not always delivered — native drag-and-drop, a context menu or
 * the window losing focus swallow it — so a lost one must not leave the pager
 * paused for good (text pushed past a page edge stayed clipped).
 */

/** Press in the editor and overfill the page, as if the release never arrived. */
async function pressWithoutRelease(page) {
  await fillSinglePage(page, { freeLines: 0 });
  await setCaret(page, { page: 0, col: 'right' });
  await page.evaluate(() => {
    const dom = document.querySelector('.editor-diary .bp-cell');
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
  });
  await page.keyboard.press('Enter'); // one more line than fits
  await page.waitForTimeout(150);
}

test('the pager waits while a button is genuinely held', async ({ page }) => {
  await openFresh(page);
  await pressWithoutRelease(page);
  expect(await clippedBoxes(page)).not.toEqual([]); // held: not paginated yet
});

const releases = {
  'a move with no button held': (page) => page.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove', { buttons: 0 }))),
  dragend: (page) => page.evaluate(() => window.dispatchEvent(new Event('dragend'))),
  'a context menu': (page) => page.evaluate(() => window.dispatchEvent(new Event('contextmenu'))),
  'the window losing focus': (page) => page.evaluate(() => window.dispatchEvent(new Event('blur'))),
};

for (const [name, release] of Object.entries(releases)) {
  test(`a lost mouseup is recovered by ${name}`, async ({ page }) => {
    await openFresh(page);
    await pressWithoutRelease(page);
    await release(page);
    await expect.poll(() => clippedBoxes(page)).toEqual([]);
    await page.evaluate(() => window.__bpTest.settle());
    expect(await page.evaluate(() => window.__bpTest.pages('right', 'diary').length)).toBe(2);
  });
}
