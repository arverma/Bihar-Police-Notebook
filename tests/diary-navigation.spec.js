import { test, expect } from '@playwright/test';
import {
  openFresh, setDoc, setCaret, settle, columnBlocks, columnPages, clippedBoxes, caret, disableTranslit,
  numberedLines, fillSinglePage,
} from './pagination-helpers.js';

/**
 * Moving around a multi-page diary.
 *
 * The pagination suite covers what happens to the text when pages spill and
 * merge. This covers what happens to the caret when the user simply moves
 * around — what decides whether the editor feels like one continuous column
 * per side or like a stack of separate boxes.
 */

/** A full first page plus three more lines on page 2. */
async function twoPages(page) {
  await openFresh(page);
  await disableTranslit(page);
  const capacity = await fillSinglePage(page);
  await setDoc(page, [{ right: [...numberedLines(1, capacity), 'spilled-1', 'spilled-2', 'spilled-3'] }]);
  expect(await columnPages(page)).toEqual([
    numberedLines(1, capacity),
    ['spilled-1', 'spilled-2', 'spilled-3'],
  ]);
  return capacity;
}

test.describe('Caret across page boundaries', () => {
  test('ArrowUp from the first line of page 2 reaches the last line of page 1', async ({ page }) => {
    const capacity = await twoPages(page);
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('ArrowUp');
    expect(await caret(page)).toMatchObject({ page: 0, col: 'right', text: String(capacity) });
  });

  test('ArrowDown from the last line of page 1 reaches the first line of page 2', async ({ page }) => {
    await twoPages(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('ArrowDown');
    expect(await caret(page)).toMatchObject({ page: 1, col: 'right', text: 'spilled-1' });
  });

  test('ArrowRight at the end of page 1 reaches the start of page 2', async ({ page }) => {
    await twoPages(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('ArrowRight');
    expect(await caret(page)).toMatchObject({ page: 1, col: 'right', text: 'spilled-1', offset: 0 });
  });

  test('ArrowLeft at the start of page 2 reaches the end of page 1', async ({ page }) => {
    const capacity = await twoPages(page);
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('ArrowLeft');
    expect(await caret(page)).toMatchObject({
      page: 0, col: 'right', text: String(capacity), offset: String(capacity).length,
    });
  });

  test('arrows stay in their own column: the left column continues on the left', async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
    await setDoc(page, [{ left: numberedLines(1, 120), right: ['r'] }]);
    expect((await columnPages(page, 'left')).length).toBeGreaterThan(1);
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.press('ArrowDown');
    expect(await caret(page)).toMatchObject({ page: 1, col: 'left' });
  });
});

test.describe('Forward delete at a page boundary', () => {
  test('Delete at the end of page 1 joins the first line of page 2 onto it', async ({ page }) => {
    const capacity = await twoPages(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Delete');
    await settle(page);
    expect(await columnBlocks(page)).toEqual([
      ...numberedLines(1, capacity - 1), `${capacity}spilled-1`, 'spilled-2', 'spilled-3',
    ]);
    expect(await clippedBoxes(page)).toEqual([]);
  });
});

test.describe('Header toggle with more than one page', () => {
  test('hiding the header pulls content back from page 2, in order', async ({ page }) => {
    const capacity = await twoPages(page);
    const before = await columnBlocks(page);
    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await settle(page);
    expect(await columnPages(page)).toEqual([before]);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(capacity).toBeGreaterThan(0);
  });

  test('the header toggle leaves focus and the caret in the text', async ({ page }) => {
    await twoPages(page);
    await setCaret(page, { page: 0, col: 'right', block: 20, offset: 1 });
    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await settle(page);
    await expect(page.locator('.editor-diary .bp-doc')).toBeFocused();
    expect(await caret(page)).toMatchObject({ page: 0, text: '21', offset: 1 });

    // The next keystroke continues where the caret was.
    await page.keyboard.type('x');
    expect(await caret(page)).toMatchObject({ page: 0, text: '2x1' });
  });
});

test.describe('Typing through a reflow', () => {
  test('typing mid-page keeps the characters together while lines spill', async ({ page }) => {
    await twoPages(page);
    await setCaret(page, { page: 0, col: 'right', block: 10 });
    await page.keyboard.type(' abcdefgh');
    await settle(page);
    expect((await columnBlocks(page))[10]).toBe('11 abcdefgh');
    expect(await caret(page)).toMatchObject({ page: 0, text: '11 abcdefgh', offset: 11 });
  });

  test('Enter at the bottom of a full page carries the caret onto the new page', async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
    await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await settle(page);
    expect(await caret(page)).toMatchObject({ page: 1, col: 'right', text: 'next', offset: 4 });
    expect(await clippedBoxes(page)).toEqual([]);
  });
});
