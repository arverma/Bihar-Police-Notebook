import { test, expect } from '@playwright/test';
import { openFresh, setCaret } from './pagination-helpers.js';

const OPTIONS = ['एक', 'दो', 'तीन', 'चार', 'पाँच'];

/** Mock Google Input Tools so every Latin word yields the same five options. */
async function mockSuggestions(page) {
  await page.route('https://inputtools.google.com/request*', (route) => {
    const text = new URL(route.request().url()).searchParams.get('text');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(['SUCCESS', [[text, OPTIONS, [], {}]]]),
    });
  });
}

/** Type a word and wait for the popup to open on it. */
async function typeWordAndOpenPopup(page, word) {
  await page.keyboard.insertText(word);
  await expect(page.locator('#suggestions .suggestion')).toHaveCount(OPTIONS.length);
}

const activeRows = (page) => page.locator('#suggestions .suggestion.active');
const cellText = (page) => page.evaluate(() => window.__bpTest.cellText(0, 'left'));
const paragraphCount = (page) => page.evaluate(
  () => document.querySelectorAll('.bp-doc .bp-cell p').length,
);

test.describe('Suggestion popup keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockSuggestions(page);
    await openFresh(page);
    await setCaret(page, { page: 0, col: 'left' });
  });

  test('first option is highlighted on open; arrows move and wrap', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    await expect(activeRows(page)).toHaveCount(1);
    await expect(activeRows(page)).toHaveText(OPTIONS[0]);

    await page.keyboard.press('ArrowDown');
    await expect(activeRows(page)).toHaveText(OPTIONS[1]);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp'); // wraps to last
    await expect(activeRows(page)).toHaveText(OPTIONS[4]);

    await page.keyboard.press('ArrowDown'); // wraps to first
    await expect(activeRows(page)).toHaveText(OPTIONS[0]);

    // Navigating must not close the popup or move the caret out of the word.
    await expect(page.locator('#suggestions')).toBeVisible();
    expect(await cellText(page)).toBe('abd');
  });

  for (const key of ['Enter', 'Tab']) {
    test(`↓ then ${key} replaces the word in place, no new paragraph`, async ({ page }) => {
      await typeWordAndOpenPopup(page, 'abd');
      const before = await paragraphCount(page);

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press(key);

      await expect(page.locator('#suggestions')).toBeHidden();
      expect(await cellText(page)).toBe(`${OPTIONS[1]} `);
      expect(await paragraphCount(page)).toBe(before);
    });
  }

  for (const key of ['Enter', 'Tab']) {
    test(`${key} with the arrows untouched accepts the highlighted first option`, async ({ page }) => {
      await typeWordAndOpenPopup(page, 'abd');
      const before = await paragraphCount(page);
      await page.keyboard.press(key);
      await expect(page.locator('#suggestions')).toBeHidden();
      expect(await cellText(page)).toBe(`${OPTIONS[0]} `);
      expect(await paragraphCount(page)).toBe(before);
    });
  }

  test('Escape then Enter keeps the English word and breaks the line', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    const before = await paragraphCount(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    expect(await cellText(page)).toContain('abd');
    expect(await paragraphCount(page)).toBe(before + 1);
  });

  test('Space commits the highlighted option, not always the first', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    expect(await cellText(page)).toBe(`${OPTIONS[2]} `);
  });

  test('clicking an option replaces the word and adds one trailing space', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    await page.locator('#suggestions .suggestion').nth(3).click();
    expect(await cellText(page)).toBe(`${OPTIONS[3]} `);
  });

  test('the next word can be typed straight after a selection', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('xyz');
    expect(await cellText(page)).toBe(`${OPTIONS[1]} xyz`);
  });

  test('no double space when whitespace already follows', async ({ page }) => {
    await page.keyboard.insertText(' rest');
    await setCaret(page, { page: 0, col: 'left', offset: 0 });
    await page.keyboard.insertText('abd');
    await expect(page.locator('#suggestions .suggestion')).toHaveCount(OPTIONS.length);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await cellText(page)).toBe(`${OPTIONS[1]} rest`);
  });

  test('Escape closes the popup and leaves the English word', async ({ page }) => {
    await typeWordAndOpenPopup(page, 'abd');
    await page.keyboard.press('Escape');
    await expect(page.locator('#suggestions')).toBeHidden();
    expect(await cellText(page)).toBe('abd');
  });

  test('Enter with the popup closed still splits the line', async ({ page }) => {
    await page.keyboard.insertText('abd');
    await page.keyboard.press('Escape');
    const before = await paragraphCount(page);
    await page.keyboard.press('Enter');
    expect(await paragraphCount(page)).toBe(before + 1);
  });
});
