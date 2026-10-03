import { test, expect } from '@playwright/test';
import { openFresh, setCaret } from './pagination-helpers.js';

test.describe('Transliteration Space Insertion', () => {
  test('should insert space correctly in the middle of a Hindi word', async ({ page }) => {
    // Mock the Google Input Tools API request
    await page.route('https://inputtools.google.com/request*', async route => {
      const url = new URL(route.request().url());
      const text = url.searchParams.get('text');
      
      // If the word is "जीवनजीना", return it as the suggestion to simulate the scenario
      if (text === 'जीवनजीना') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify([
            'SUCCESS',
            [[text, [text], [], { candidate_type: [0] }]]
          ])
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify([
            'SUCCESS',
            [[text, [text], [], { candidate_type: [0] }]]
          ])
        });
      }
    });

    await openFresh(page);

    // Type into the diary's left column, then put the caret between 'न' and 'ज'.
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.insertText('जीवनजीना');
    await setCaret(page, { page: 0, col: 'left', offset: 4 });

    await page.keyboard.press('Space');

    // The space goes in the middle, not at the end
    await expect.poll(() => page.evaluate(() => window.__bpTest.cellText(0, 'left'))).toBe('जीवन जीना');
  });
});
