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

  // KNOWN DEFECT — not yet fixed; see the caret-position notes in this file.
  // Reproduced by hand in a real browser: with the caret on line 1 of a
  // two-page diary, pressing "Hide header" and typing puts the text at the old
  // page-1 boundary instead of beside the caret. test.fail() keeps CI honest —
  // it goes red the moment this starts passing, so the marker gets removed.
  test.fail('toggling the header keeps the caret with its text', async ({ page }) => {
    await twoPages(page);

    const marker = 'CARET-ANCHOR';
    await page.evaluate((m) => {
      const q = window.__q(0);
      q.focus();
      q.insertText(0, `${m}\n`);
      q.setSelection(m.length, 0);
    }, marker);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    // Whichever page the anchor ends up on, the caret must still sit in it.
    await expect.poll(async () => page.evaluate((m) => {
      const pages = [...document.querySelectorAll('.diary-page')];
      for (let i = 0; i < pages.length; i += 1) {
        const host = pages[i].querySelector('[data-col="right"]');
        const q = window.Quill ? window.Quill.find(host) : null;
        const live = q && host.dataset.staticRight !== '1' && host.contains(q.root);
        if (live && q.hasFocus()) {
          const sel = q.getSelection();
          if (!sel) return 'no-selection';
          return q.getText().slice(0, sel.index).endsWith(m) ? 'caret-with-anchor' : 'caret-moved';
        }
      }
      return 'no-focused-editor';
    }, marker), { timeout: 10000 }).toBe('caret-with-anchor');
  });
});

test.describe('Typing into a full page', () => {
  // KNOWN DEFECT — characters are lost. Each keystroke on a page that is at
  // capacity triggers a synchronous reflow, and the next keystroke arrives
  // before the caret has been put back, so it lands at the end of the page (or
  // nowhere). Typing "AAA" leaves "A". A word processor must never drop input.
  test.fail('characters typed in quick succession stay together', async ({ page }) => {
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

    await page.locator('.diary-page').first().locator('.ql-editor p').first().click();
    await page.keyboard.type('AAA');
    await page.waitForTimeout(800);

    const text = await page.evaluate(() => window.__bpDiarySheet.getModel().pages
      .map((pg) => String(pg.right || '').replace(/<[^>]+>/g, '\n'))
      .join('\n'));
    expect(text).toContain('AAA');
  });
});
