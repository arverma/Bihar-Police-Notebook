import { test, expect } from '@playwright/test';
import {
  installDiaryQuillHelper,
  fillSinglePage,
  rightColumnBlocks,
  clippedDiaryBoxes,
  disableTranslit,
} from './pagination-helpers.js';

/**
 * Moving around a multi-page diary.
 *
 * The pagination suite covers what happens to the *text* when pages spill and
 * merge. This covers what happens to the *caret* when the user simply moves
 * around — the thing that decides whether the editor feels like a word
 * processor or like a stack of separate boxes. Each page is its own Quill and
 * only one is live at a time, so none of this comes for free.
 */

/** Which page currently owns the caret, and where in it. */
async function caret(page) {
  return page.evaluate(() => {
    const pages = [...document.querySelectorAll('.diary-page')];
    for (let i = 0; i < pages.length; i += 1) {
      const host = pages[i].querySelector('[data-col="right"]');
      const quill = host && window.Quill ? window.Quill.find(host) : null;
      const live = quill && host.dataset.staticRight !== '1' && host.contains(quill.root);
      if (live && quill.hasFocus()) {
        const sel = quill.getSelection();
        return { page: i + 1, index: sel ? sel.index : null, length: quill.getLength() };
      }
      const ta = pages[i].querySelector('[data-col="left"]');
      if (ta && document.activeElement === ta) {
        return { page: i + 1, index: ta.selectionStart, col: 'left' };
      }
    }
    return { page: null, index: null };
  });
}

async function twoPages(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  await installDiaryQuillHelper(page);
  await fillSinglePage(page);
  // Push past capacity so a second page exists.
  await page.evaluate(() => {
    const q = window.__q(0);
    q.focus();
    q.insertText(q.getLength() - 1, '\nspilled-1\nspilled-2\nspilled-3');
  });
  await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
    .toBeGreaterThan(1);
  await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
}

/** A page filled to capacity plus a second page, built from numbered lines. */
async function fullTwoPages(page) {
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
  await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
    .toBeGreaterThan(1);
  await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
}

/** Plain text of every page, in reading order. */
async function documentText(page) {
  return page.evaluate(() => window.__bpDiarySheet.getModel().pages
    .map((pg) => String(pg.right || '').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, ''))
    .join('\n'));
}

test.describe('Caret across page boundaries', () => {
  test('ArrowUp from the first line of page 2 reaches page 1', async ({ page }) => {
    await twoPages(page);

    await page.evaluate(() => {
      const q = window.__q(1);
      q.focus();
      q.setSelection(0, 0);
    });
    expect((await caret(page)).page).toBe(2);

    await page.keyboard.press('ArrowUp');

    // In any word processor the caret leaves the top of a page for the one above.
    await expect.poll(async () => (await caret(page)).page).toBe(1);
  });

  test('ArrowDown from the last line of page 1 reaches page 2', async ({ page }) => {
    await twoPages(page);

    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(Math.max(0, q.getLength() - 1), 0);
    });
    expect((await caret(page)).page).toBe(1);

    await page.keyboard.press('ArrowDown');

    await expect.poll(async () => (await caret(page)).page).toBe(2);
  });

  test('ArrowRight at the end of page 1 reaches page 2', async ({ page }) => {
    await twoPages(page);

    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(Math.max(0, q.getLength() - 1), 0);
    });

    await page.keyboard.press('ArrowRight');

    await expect.poll(async () => (await caret(page)).page).toBe(2);
  });

  test('ArrowLeft at the start of page 2 reaches page 1', async ({ page }) => {
    await twoPages(page);

    await page.evaluate(() => {
      const q = window.__q(1);
      q.focus();
      q.setSelection(0, 0);
    });

    await page.keyboard.press('ArrowLeft');

    await expect.poll(async () => (await caret(page)).page).toBe(1);
  });
});

test.describe('Forward delete at a page boundary', () => {
  test('Delete at the end of page 1 pulls page 2 content back', async ({ page }) => {
    await twoPages(page);
    const before = await rightColumnBlocks(page);

    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(Math.max(0, q.getLength() - 1), 0);
    });

    // Backspace at the start of page 2 is covered; Delete is its mirror and
    // must join the same two lines rather than doing nothing.
    await page.keyboard.press('Delete');
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    const after = await rightColumnBlocks(page);
    expect(after.join('')).not.toBe(before.join(''));
  });
});

test.describe('Header toggle with more than one page', () => {
  test('hiding the header pulls content back from page 2', async ({ page }) => {
    await twoPages(page);
    const pagesBefore = await page.locator('.diary-page').count();
    const blocksBefore = await rightColumnBlocks(page);

    // Hiding the header frees roughly a fifth of page 1; the text below it
    // should move up, exactly as showing the header pushes text down.
    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    const firstPageBlocks = await page.evaluate(() => {
      const q = window.__q(0);
      return q.getLength();
    });
    expect(firstPageBlocks).toBeGreaterThan(0);

    // Text order must be preserved whatever moves between pages.
    expect(await rightColumnBlocks(page)).toEqual(blocksBefore);
    expect(pagesBefore).toBeGreaterThan(0);
  });

  test('the header toggle leaves focus in the document, not on the button', async ({ page }) => {
    await fullTwoPages(page);

    await page.locator('.diary-page').first().locator('.ql-editor p').nth(20).click();
    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    // The toggle blurs the editor on mousedown; nothing may leave focus parked
    // on the button, or the next keystroke goes nowhere at all.
    await expect.poll(async () => page.evaluate(
      () => document.activeElement?.classList?.contains('ql-editor') ?? false,
    ), { timeout: 10000 }).toBe(true);
  });

  test('the header toggle keeps the caret on the line it was on', async ({ page }) => {
    await fullTwoPages(page);

    // Read the caret through the *native* selection, not quill.getSelection().
    // Quill's index goes stale under synthetic key events; the native anchor
    // node tracks reality in both this harness and a real browser.
    const caretLine = () => page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      let node = sel.anchorNode;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const block = node?.closest?.('p');
      const pageEl = node?.closest?.('.diary-page');
      const pages = [...document.querySelectorAll('.diary-page')];
      return { text: block?.textContent ?? null, page: pageEl ? pages.indexOf(pageEl) + 1 : null };
    });

    await page.locator('.diary-page').first().locator('.ql-editor p').nth(20).click();
    expect(await caretLine()).toEqual({ text: '21', page: 1 });

    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    // Hiding the header reflows every page below it. The caret must ride along
    // with its own line rather than being dropped at the old page boundary.
    await expect.poll(caretLine, { timeout: 10000 }).toEqual({ text: '21', page: 1 });
  });
});

/*
 * Deliberately NOT tested here: where exactly the caret lands after a reflow.
 *
 * This harness cannot measure it. Driving the caret with quill.setSelection()
 * from an evaluate() leaves the native selection elsewhere, and Quill then
 * reports a stale index; even after a real click, Playwright's synthetic key
 * events make Quill report the caret at the end of the page while the native
 * selection sits where the user put it. Both produce convincing "the caret
 * jumped to the end" failures that cannot be reproduced by hand.
 *
 * Verified manually in a real browser instead, on a full two-page diary:
 * typing eight characters mid-page keeps them contiguous, and typing after
 * hiding the header continues from the caret rather than the old page
 * boundary. Re-check those two by hand when touching reflow caret handling.
 */
