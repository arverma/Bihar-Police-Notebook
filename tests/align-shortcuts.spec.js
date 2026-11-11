import { test, expect } from '@playwright/test';
import { openFresh, setCaret } from './pagination-helpers.js';

// Cmd/Ctrl+Shift+L/E/R/J belong to the browser (Cmd+Shift+R is a hard reload).
// The editor must neither act on them nor cancel them; alignment is toolbar-only.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const alignOfCaret = (page) => page.evaluate(() => {
  const n = getSelection().anchorNode;
  const el = n?.nodeType === 3 ? n.parentElement : n;
  return getComputedStyle(el.closest('p')).textAlign;
});

async function typeAndWatchKeydown(page) {
  await openFresh(page);
  await setCaret(page, { page: 0, col: 'right' });
  await page.keyboard.insertText('अमन');
  // Record whether any handler cancelled the shortcut (a cancelled one is swallowed).
  await page.evaluate(() => {
    window.__cancelled = [];
    // Bubble phase on window: runs after the editor's own handlers.
    window.addEventListener('keydown', (e) => {
      if (e.key.length === 1) window.__cancelled.push(e.defaultPrevented);
    });
  });
}

for (const key of ['L', 'E', 'R', 'J']) {
  test(`${mod}+Shift+${key} is left to the browser and changes nothing`, async ({ page }) => {
    await typeAndWatchKeydown(page);
    const before = await alignOfCaret(page);
    await page.keyboard.press(`${mod}+Shift+${key}`);
    expect(await page.evaluate(() => window.__cancelled)).toEqual([false]);
    expect(await alignOfCaret(page)).toBe(before);
  });
}

test('the toolbar centre button still aligns', async ({ page }) => {
  await typeAndWatchKeydown(page);
  await page.locator('button[data-cmd="align:center"]').click();
  expect(await alignOfCaret(page)).toBe('center');
});
