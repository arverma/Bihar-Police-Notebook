import { test, expect } from '@playwright/test';
import { installDiaryQuillHelper, clippedDiaryBoxes, disableTranslit } from './pagination-helpers.js';

/**
 * Undo/redo must restore a *valid layout*, not just the right characters.
 *
 * A snapshot records content. The layout it was captured in may not be the one
 * it is restored into — pagination is measured against the live box, so a
 * diary stored on one screen (or before an open-repair) can need re-cutting
 * when it comes back. The existing undo tests build their documents by
 * editing, so every snapshot in their history already fits; this covers the
 * case where one does not.
 */

/** Open a stored diary whose content no longer fits one page, as on load. */
async function openOverflowingDocument(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  await disableTranslit(page);
  await installDiaryQuillHelper(page);
  await page.evaluate(() => window.__bpDiarySheet.setModel({
    pages: [{
      hasHeader: true,
      header: {},
      left: '',
      right: Array.from({ length: 60 }, (_, i) => `<p>${i + 1}</p>`).join(''),
    }],
  }));
  // The pager repairs it on open.
  await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 20000 })
    .toBeGreaterThan(1);
  await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 15000 }).toEqual([]);
}

/**
 * Make a real user-source edit.
 *
 * Not via keyboard: Playwright's synthetic key events do not reliably reach
 * this editor once a reflow is in flight (they leave Quill reporting a caret
 * it does not have). The bug under test is about what undo *restores*, not
 * about key handling, so a user-source insert is the honest way in — it goes
 * through the same text-change, reflow and history path a keystroke does.
 */
async function makeEdit(page, text) {
  await page.evaluate((t) => {
    const quill = window.__q(0);
    quill.focus();
    quill.insertText(0, t, 'user');
  }, text);
  await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 15000 }).toEqual([]);
}

const documentText = (page) => page.evaluate(() => window.__bpDiarySheet.getModel().pages
  .map((p) => String(p.right || '').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, ''))
  .join('\n'));

test.describe('Undo on a document that needed repair on open', () => {
  test('undo leaves a laid-out document, not a clipped page', async ({ page }) => {
    await openOverflowingDocument(page);
    await makeEdit(page, 'EDIT-');
    expect(await documentText(page)).toContain('EDIT-1');

    await page.evaluate(() => window.__bpDiarySheet.undo());

    // The edit must go, and what is left must still fit its pages: render()'s
    // own overflow check runs while history.applying is still true and bails,
    // so without an explicit re-fit the restored page stays cut off.
    await expect.poll(async () => documentText(page), { timeout: 15000 })
      .not.toContain('EDIT-');
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 15000 }).toEqual([]);
    expect(await documentText(page)).toContain('60');
  });

  test('redo leaves a laid-out document too', async ({ page }) => {
    await openOverflowingDocument(page);
    await makeEdit(page, 'EDIT-');

    await page.evaluate(() => window.__bpDiarySheet.undo());
    await expect.poll(async () => documentText(page), { timeout: 15000 }).not.toContain('EDIT-');

    await page.evaluate(() => window.__bpDiarySheet.redo());

    await expect.poll(async () => documentText(page), { timeout: 15000 }).toContain('EDIT-1');
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 15000 }).toEqual([]);
  });
});
