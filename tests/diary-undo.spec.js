import { test, expect } from '@playwright/test';
import {
  openFresh, setDoc, setCaret, settle, columnBlocks, columnPages, clippedBoxes, caret, disableTranslit, numberedLines,
} from './pagination-helpers.js';

/**
 * Undo/redo must restore a valid layout, not just the right characters — and
 * one undo must take back an edit together with the reflow it caused.
 */

async function openOverflowingDocument(page) {
  await openFresh(page);
  await disableTranslit(page);
  // A stored document that no longer fits one page is repaired on open.
  await setDoc(page, [{ right: numberedLines(1, 60) }]);
  expect((await columnPages(page)).length).toBeGreaterThan(1);
  expect(await clippedBoxes(page)).toEqual([]);
}

const undo = (page) => page.keyboard.press('ControlOrMeta+z');
const redo = (page) => page.keyboard.press('ControlOrMeta+Shift+z');

test.describe('Undo and redo across pagination', () => {
  test('opening a document is not an undoable step', async ({ page }) => {
    await openOverflowingDocument(page);
    await setCaret(page, { page: 0, col: 'right', block: 0, offset: 0 });
    await undo(page);
    await settle(page);
    expect(await columnBlocks(page)).toEqual(numberedLines(1, 60));
  });

  test('undo leaves a laid-out document, not a clipped page', async ({ page }) => {
    await openOverflowingDocument(page);
    await setCaret(page, { page: 0, col: 'right', block: 0, offset: 0 });
    await page.keyboard.type('EDIT-');
    await settle(page);
    expect((await columnBlocks(page))[0]).toBe('EDIT-1');

    await undo(page);
    await settle(page);
    expect(await columnBlocks(page)).toEqual(numberedLines(1, 60));
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('redo leaves a laid-out document too', async ({ page }) => {
    await openOverflowingDocument(page);
    await setCaret(page, { page: 0, col: 'right', block: 0, offset: 0 });
    await page.keyboard.type('EDIT-');
    await settle(page);
    await undo(page);
    await settle(page);
    await redo(page);
    await settle(page);
    expect((await columnBlocks(page))[0]).toBe('EDIT-1');
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('one undo takes back an Enter that spilled a line onto a new page', async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
    // Exactly one full page.
    await setDoc(page, [{ right: numberedLines(1, 80) }]);
    const capacity = (await columnPages(page))[0].length;
    await setDoc(page, [{ right: numberedLines(1, capacity) }]);
    expect((await columnPages(page)).length).toBe(1);

    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await columnPages(page)).length).toBe(2);
    expect((await caret(page)).page).toBe(1);

    await undo(page);
    await settle(page);
    expect(await columnPages(page)).toEqual([numberedLines(1, capacity)]);
    const c = await caret(page);
    expect(c).toMatchObject({ page: 0, text: String(capacity), offset: String(capacity).length });
  });

  test('header edits undo with the same shortcut as body text', async ({ page }) => {
    await openFresh(page);
    const thana = page.locator('[data-field="thana"]').first();
    await thana.click();
    await thana.pressSequentially('Patna');
    await expect.poll(() => page.evaluate(() => window.__bpTest.headers()[0].fields.thana)).toBe('Patna');

    await undo(page);
    await expect(thana).toHaveValue('');
    await redo(page);
    await expect(thana).toHaveValue('Patna');
  });
});
