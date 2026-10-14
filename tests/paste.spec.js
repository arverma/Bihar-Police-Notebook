import { test, expect } from '@playwright/test';
import { openFresh, setDoc, setCaret, settle, columnBlocks, disableTranslit } from './pagination-helpers.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Copy and paste inside the editor', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  test('copying several Hindi lines and pasting on a new line stays plain paragraphs', async ({ page }) => {
    const lines = ['पहली पंक्ति', 'दूसरी पंक्ति', 'तीसरी पंक्ति'];
    await setDoc(page, [{ right: [...lines] }]);
    await setCaret(page, { col: 'right', page: 0, block: 0 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    await setCaret(page, { col: 'right', page: 0, block: 2 });
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+v');
    await settle(page);
    expect(await page.locator('.bp-cell table').count()).toBe(0);
    expect(await columnBlocks(page)).toEqual([...lines, ...lines]);
  });
});

test.describe('Copy variants', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });
  const variants = {
    'selection that starts and ends mid-line': async (page) => {
      await setCaret(page, { col: 'right', page: 0, block: 0 });
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
    },
    'whole lines selected to the start of the next line': async (page) => {
      await setCaret(page, { col: 'right', page: 0, block: 0 });
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
    },
  };
  for (const [name, select] of Object.entries(variants)) {
    test(`paste after ${name} has no table`, async ({ page }) => {
      await setDoc(page, [{ right: ['पहली पंक्ति', 'दूसरी पंक्ति', 'तीसरी पंक्ति', 'चौथी पंक्ति', ''] }]);
      await select(page);
      await page.keyboard.press('ControlOrMeta+c');
      await setCaret(page, { col: 'right', page: 0, block: 4 });
      await page.keyboard.press('ControlOrMeta+v');
      await settle(page);
      expect(await page.locator('.bp-cell table').count()).toBe(0);
    });
  }
});
