import { test, expect } from '@playwright/test';

/**
 * Runs under the `mobile` (393px) and `tablet` (768px) projects — both inside
 * the `(max-width: 768px)` branch that four modules key off and that nothing
 * covered before. Rendering and mobile layout are this repo's most-repaired
 * area, so these assert the branch's observable contract rather than pixels;
 * the pixel side lives in tests/visual/.
 */

async function gotoDiary(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  await expect(page.locator('.diary-page').first()).toBeVisible();
}

test.describe('Mobile layout', () => {
  test('the page never scrolls sideways', async ({ page }) => {
    await gotoDiary(page);

    // The classic responsive regression: something overflows and the whole
    // document pans horizontally.
    const overflow = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(overflow.docWidth).toBeLessThanOrEqual(overflow.viewport + 1);
  });

  test('header chrome fits the viewport', async ({ page }) => {
    await gotoDiary(page);

    const header = page.locator('.header-frame');
    await expect(header).toBeVisible();

    const spill = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      document.querySelectorAll('.header-frame *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > vw + 1 || r.left < -1) {
          bad.push(`${el.tagName}.${el.className}`.slice(0, 60));
        }
      });
      return bad;
    });
    expect(spill).toEqual([]);
  });

  test('the dictation FAB is hidden', async ({ page }) => {
    await gotoDiary(page);

    // dictation-ui.js syncFabVisibility(): the FAB is desktop-only, and the
    // engine is stopped rather than left listening behind a hidden button.
    const fab = page.locator('#dictationFab');
    if (await fab.count()) {
      await expect(fab).toBeHidden();
    }
  });

  test('the A4 page is scaled to fit rather than cropped', async ({ page }) => {
    await gotoDiary(page);

    // page-scale.js fits an unscaled 794px A4 page into a narrower screen.
    const fits = await page.evaluate(() => {
      const page1 = document.querySelector('.diary-page');
      const r = page1.getBoundingClientRect();
      return { pageRight: r.right, pageLeft: r.left, vw: document.documentElement.clientWidth };
    });
    expect(fits.pageLeft).toBeGreaterThanOrEqual(-1);
    expect(fits.pageRight).toBeLessThanOrEqual(fits.vw + 1);
  });

  test('transliteration is off so the OS keyboard is not fought', async ({ page }) => {
    await gotoDiary(page);

    // main.js isTransliterationEnabled() is false on mobile regardless of the
    // toggle, so Hinglish must stay as typed and no suggestion box may open.
    const thana = page.locator('[data-field="thana"]').first();
    await thana.click();
    await thana.pressSequentially('patna ');

    await expect(thana).toHaveValue('patna ');
    await expect(page.locator('#suggestions')).toBeHidden();
  });
});
