import { test, expect } from '@playwright/test';
import { openFresh, setCaret } from './pagination-helpers.js';

for (const key of ['Backspace', 'Delete']) {
  test(`Select all then ${key} clears the typed text`, async ({ page, browserName }) => {
    await openFresh(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText('अमन रंजन');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('वर्मा जी लॉ,');
    const mod = process.platform === 'darwin' || browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+A`);
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.__bpTest.cellText(0, 'right'))).toBe('');
  });
}

// A line of text followed by an empty line (caret on it): Select all + Delete did nothing,
// because ProseMirror clears a multi-line cell as "replace the cell", which the
// cell-boundary guard rejected.
for (const key of ['Backspace', 'Delete']) {
  test(`Select all then ${key} clears a line followed by an empty line`, async ({ page }) => {
    await openFresh(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText('अमन ');
    await page.keyboard.press('Enter');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.__bpTest.cellText(0, 'right'))).toBe('');
  });
}
