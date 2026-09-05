import { test, expect } from '@playwright/test';
import { installDiaryQuillHelper, clippedDiaryBoxes } from '../pagination-helpers.js';

/**
 * Pixel baselines for the states users actually look at.
 *
 * Assertion tests answer "are the numbers right"; nothing answered "does it
 * look right", which is the failure this repo keeps shipping — five
 * consecutive "Fix rendering" merges plus a mobile toolbar fix, none of which
 * any existing test could have caught.
 *
 * Shots are scoped to one A4 page element at a time. A viewport shot silently
 * crops to 1280x720, so a two-page document would only ever prove page 1
 * renders; and the pages container cannot be shot whole because it lives
 * inside a CSS-transformed, internally-scrolled stage, which captures part
 * blank. One page per baseline also makes a diff say *which* page moved.
 *
 * Floating chrome is hidden with `visibility` (not `display`, which would
 * reflow) for the document shots: the toolbar, FAB and toasts are position-
 * fixed over the stage and would otherwise land in the middle of a page.
 * Chrome gets its own baseline below.
 *
 * Baselines are Linux-only on purpose — see snapshotPathTemplate in
 * playwright.config.js. Regenerate with `npm run test:visual:update`.
 */

/** Defaults to today's date, so an unmasked baseline expires overnight. */
const dateMask = (page) => [page.locator('[data-field="fir_date"]')];

const SHOT = {
  animations: 'disabled',
  caret: 'hide',
  // Font antialiasing varies by a hair even on one platform.
  maxDiffPixelRatio: 0.002,
};

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  // Devanagari webfonts change metrics; a shot taken mid-swap is noise.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.diary-page').first()).toBeVisible();
}

/** Drop focus and let every transient overlay expire before freezing a frame. */
async function settle(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  // showNotification() toasts live ~2.5s including the fade.
  await expect(page.locator('.restore-message')).toHaveCount(0, { timeout: 8000 });
}

/**
 * Prepare a deterministic frame: hide floating chrome and let the stage grow to
 * its content.
 *
 * The stage scrolls internally, so only the visible slice is ever painted, and
 * per-element screenshots cannot be used either — under the stage's CSS
 * transform an element's layout box diverges from where it paints, and the
 * capture silently contains a *different* page. Letting the document grow and
 * taking one full-page shot is the only capture that reliably matches what is
 * on screen.
 *
 * Chrome is hidden with `visibility` (not `display`, which would reflow the
 * thing under test). It has its own baseline.
 */
async function freezeFrame(page) {
  await page.addStyleTag({
    content: `
      #quillToolbar, #dictationFab, #dictationInterim, .restore-message,
      .punctuation-panel, .punctuation-toggle, .header-frame,
      .diary-header-toggle, .page-badge, #pageIndicator, .page-fit-chip,
      .diary-page-delete, .help-fab { visibility: hidden !important; }
      .editor-stage {
        height: auto !important; max-height: none !important;
        overflow: visible !important;
      }`,
  });
  // Grow the *viewport* to the document instead of relying on fullPage: the
  // body is fixed-height with the scroll inside the stage, so fullPage returns
  // one screenful and page 2 never appears.
  const needed = await page.evaluate(() => {
    const host = document.querySelector('#diaryPages, #letterPages');
    const pages = [...document.querySelectorAll('.diary-page, .letter-page')];
    if (!host || !pages.length) return null;
    const top = Math.min(...pages.map((p) => p.getBoundingClientRect().top));
    const bottom = Math.max(...pages.map((p) => p.getBoundingClientRect().bottom));
    return Math.ceil(bottom - top) + 80;
  });
  if (needed) {
    await page.setViewportSize({ width: 1280, height: Math.min(needed, 8000) });
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** One full-page baseline of the whole document, all pages included. */
async function shotDocument(page, name) {
  await expect(page).toHaveScreenshot(name, {
    ...SHOT,
    fullPage: true,
    // Every page carries its own date field; mask them all.
    mask: [page.locator('[data-field="fir_date"]'), page.locator('#filenameInput')],
  });
}

test.describe('Appearance', () => {
  test('diary, empty', async ({ page }) => {
    await ready(page);
    await settle(page);
    await freezeFrame(page);
    await shotDocument(page, 'diary-empty.png');
  });

  test('diary, header hidden', async ({ page }) => {
    await ready(page);
    await page.locator('.diary-header-toggle').first().click();
    await expect(page.locator('.diary-header-toggle').first()).toHaveText(/Show header/);
    await settle(page);
    await freezeFrame(page);
    await shotDocument(page, 'diary-header-hidden.png');
  });

  test('diary, spilled onto a second page', async ({ page }) => {
    await ready(page);
    await installDiaryQuillHelper(page);

    await page.evaluate((text) => {
      const quill = window.__q(0);
      if (!quill) throw new Error('page 1 quill missing');
      quill.setText(text);
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(20));

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    // The suite's own invariant: no page box is clipped, i.e. reflow has settled.
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
    await settle(page);
    await freezeFrame(page);
    await shotDocument(page, 'diary-spilled-two-pages.png');
  });

  test('letter template', async ({ page }) => {
    await ready(page);
    await page.locator('[data-template="letter"]').click();
    await expect(page.locator('.letter-page').first()).toBeVisible();
    await settle(page);
    await freezeFrame(page);
    await shotDocument(page, 'letter-empty.png');
  });

  test('header chrome', async ({ page }) => {
    await ready(page);
    await settle(page);
    // Header layout is its own repeat-offender (mobile toolbar, header rework).
    await expect(page.locator('.header-frame')).toHaveScreenshot('chrome-header.png', {
      ...SHOT, mask: [page.locator('#filenameInput')],
    });
  });
});
