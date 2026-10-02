import { test, expect } from '@playwright/test';
import { openFresh, setCaret, settle, disableTranslit } from './pagination-helpers.js';

/** Leading and repeated spaces are content: they must survive save and reopen. */
const SPACED_TEXT = '   सेंटर  word';

test.describe('Space preservation', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  async function typeIntoRightColumn(page, text) {
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText(text);
    await settle(page);
    await page.waitForTimeout(800); // autosave debounce
  }

  const rightText = (page) => page.evaluate(() => window.__bpTest.cellText(0, 'right'));

  test('leading and double spaces survive page reload', async ({ page }) => {
    await typeIntoRightColumn(page, SPACED_TEXT);
    await page.reload();
    await page.waitForFunction(() => window.__uxInitComplete === true);
    await settle(page);
    expect(await rightText(page)).toBe(SPACED_TEXT);
  });

  test('leading and double spaces survive history reopen', async ({ page }) => {
    await typeIntoRightColumn(page, SPACED_TEXT);

    await page.locator('.switch-btn').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.add-template-btn').click();
    await expect.poll(() => rightText(page)).toBe('');

    await page.locator('.history-item').first().click();
    await expect.poll(() => rightText(page)).toBe(SPACED_TEXT);
  });

  test('spaces render on screen exactly as typed', async ({ page }) => {
    await typeIntoRightColumn(page, SPACED_TEXT);
    const rendered = await page.locator('.editor-diary .bp-cell[data-col="right"] p').first()
      .evaluate((p) => p.textContent);
    expect(rendered).toBe(SPACED_TEXT);
  });
});
