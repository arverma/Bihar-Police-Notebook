import { test, expect } from '@playwright/test';
import { openFresh, setCaret } from './pagination-helpers.js';

/** Fixed suggestions so the test never depends on the live service. */
async function mockSuggestions(page, table) {
  await page.route('https://inputtools.google.com/request*', async (route) => {
    const text = new URL(route.request().url()).searchParams.get('text') || '';
    const out = table[text] ? [table[text]] : [text];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(['SUCCESS', [[text, out, [], { candidate_type: [0] }]]]),
    });
  });
}

test.describe('Transliteration while typing fast', () => {
  test('Space replaces the typed word with its Devanagari form', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'transliteration is desktop-only');
    await mockSuggestions(page, { aman: 'अमन' });
    await openFresh(page);
    await expect(page.locator('#translitToggle')).toBeChecked();

    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.type('aman', { delay: 50 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');

    const cell = page.locator('.editor-diary .bp-cell[data-col="right"]').first();
    await expect(cell).toHaveText(/अमन/);
    await expect(cell).not.toHaveText(/aman/);
    // The replacement leaves the caret after the inserted space.
    const c = await page.evaluate(() => window.__bpTest.caret());
    expect(c.text.slice(0, c.offset)).toBe('अमन ');
  });

  test('bold survives the replacement', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'transliteration is desktop-only');
    await mockSuggestions(page, { aman: 'अमन' });
    await openFresh(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('aman', { delay: 50 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await expect(page.locator('.editor-diary .bp-cell[data-col="right"] strong').first()).toHaveText(/अमन/);
  });
});
