import { test, expect } from '@playwright/test';
import { openFresh, setCaret, fillSinglePage, clippedBoxes } from './pagination-helpers.js';

/**
 * Pagination pauses while the Hinglish suggestion popup is open. A popup that
 * outlives the word it was opened for therefore freezes the page: Enter at the
 * bottom of a full page pushed the new line past the edge and it stayed
 * clipped until the user clicked elsewhere. The popup must close whenever the
 * caret leaves the word — and a suggestion still in flight must not reopen it.
 */

/** @param {number} delayMs how long the (mocked) suggestion service takes to answer */
async function mockSuggestions(page, delayMs = 0) {
  await page.route('https://inputtools.google.com/request*', async (route) => {
    const text = new URL(route.request().url()).searchParams.get('text') || '';
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(['SUCCESS', [[text, [text === 'aman' ? 'अमन' : text], [], { candidate_type: [0] }]]]),
    });
  });
}

const popupOpen = (page) => page.evaluate(() => {
  const box = document.getElementById('suggestions');
  return getComputedStyle(box).display !== 'none' && box.childElementCount > 0;
});

/** A completely full first page with the caret at the end of its last line. */
async function fullPageCaretAtEnd(page) {
  await fillSinglePage(page, { freeLines: 0 });
  await setCaret(page, { page: 0, col: 'right' });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'transliteration is desktop-only');
});

for (const key of ['Enter', 'ArrowLeft', 'Escape']) {
  test(`${key} closes the popup, and the page is not left frozen`, async ({ page }) => {
    await mockSuggestions(page);
    await openFresh(page);
    await fullPageCaretAtEnd(page);
    await page.keyboard.type('aman', { delay: 30 });
    await expect.poll(() => popupOpen(page)).toBe(true);

    await page.keyboard.press(key);
    await expect.poll(() => popupOpen(page)).toBe(false);
    // Nothing is clipped once pagination is free to run.
    await expect.poll(() => clippedBoxes(page)).toEqual([]);
    await page.evaluate(() => window.__bpTest.settle());
  });
}

test('Enter at the bottom of a full page moves the new line to page 2 without a click', async ({ page }) => {
  await mockSuggestions(page);
  await openFresh(page);
  await fullPageCaretAtEnd(page);
  await page.keyboard.type('aman', { delay: 30 });
  await expect.poll(() => popupOpen(page)).toBe(true);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__bpTest.settle());
  expect(await page.evaluate(() => window.__bpTest.pages('right', 'diary').length)).toBe(2);
  expect(await clippedBoxes(page)).toEqual([]);
});

test('a suggestion that arrives after Enter does not reopen the popup', async ({ page }) => {
  await mockSuggestions(page, 500);
  await openFresh(page);
  await fullPageCaretAtEnd(page);
  await page.keyboard.type('aman', { delay: 30 });
  // The 50ms typing timer has fired and the (slow) request is in flight.
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  expect(await popupOpen(page)).toBe(false);
  await page.evaluate(() => window.__bpTest.settle());
  expect(await clippedBoxes(page)).toEqual([]);
});

test('typing on still shows suggestions (the popup is not suppressed in general)', async ({ page }) => {
  await mockSuggestions(page);
  await openFresh(page);
  await setCaret(page, { page: 0, col: 'right' });
  await page.keyboard.type('aman', { delay: 30 });
  await expect.poll(() => popupOpen(page)).toBe(true);
});
