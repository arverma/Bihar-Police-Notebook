import { test, expect } from '@playwright/test';

/**
 * Regressions found by a responsive audit across desktop, tablet and phone
 * widths. Each sets its own viewport, so they run once (chromium project).
 *
 * Width sweeps load the app once and resize between widths (one page load
 * instead of one per width, which dominated this suite's run time). Layout
 * reacts to resize asynchronously, so each width's checks retry until they
 * settle, and the failing width is named in the error.
 */
async function open(page, width, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.waitForSelector('.editor-diary .diary-page');
  await page.waitForFunction(() => window.__uxInitComplete);
}

/** Resize, then run `check` until the layout settles. Fails naming the width. */
async function atWidth(page, width, check, height = 800) {
  await page.setViewportSize({ width, height });
  try {
    await expect(async () => { await check(); }).toPass({ timeout: 5000 });
  } catch (err) {
    err.message = `at ${width}px: ${err.message}`;
    throw err;
  }
}

test.describe('A4 page fits the screen (never cropped on the right)', () => {
  test('diary page fits at every width from 320 to 1000px', async ({ page }) => {
    await open(page, 320);
    for (const width of [320, 340, 360, 375, 393, 430, 600, 768, 820, 1000]) {
      await atWidth(page, width, async () => {
        const box = await page.locator('.editor-diary .diary-page').first().boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      });
    }
  });

  test('letter page fits at 360px', async ({ page }) => {
    await open(page, 360);
    await page.locator('.switch-btn').click();
    await page.locator('#typeSwitchBtn').click();
    await page.locator('#templateSegment [data-template="letter"]').click();
    await expect(page.locator('.editor-letter')).toBeVisible();
    // Close the panel so it does not cover the page we are measuring.
    if (await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'))) {
      await page.locator('.switch-btn').click();
    }
    await page.waitForTimeout(500);
    const box = await page.locator('.editor-letter .letter-page, .editor-letter .bp-page').first().boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(361);
  });
});

test.describe('dialogs stay inside the viewport on phones', () => {
  test('trash, unsupported-docs and dictation dialogs fit at 320, 360 and 393px', async ({ page }) => {
    await open(page, 320);
    for (const width of [320, 360, 393]) {
      for (const id of ['trashDialog', 'unsupportedDocDialog', 'dictationSheet']) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate((i) => document.getElementById(i).showModal(), id);
        await atWidth(page, width, async () => {
          const box = await page.locator(`#${id}`).boundingBox();
          expect(box.x, `#${id} left edge`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `#${id} right edge`).toBeLessThanOrEqual(width);
        });
        await page.evaluate((i) => document.getElementById(i).close(), id);
      }
    }
  });
});

test.describe('document name has room in the header', () => {
  test('default name is not clipped from 320 to 1440px', async ({ page }) => {
    await open(page, 320);
    const input = page.locator('#filenameInput');
    expect(await input.inputValue()).toMatch(/\d{4}/);
    for (const width of [320, 393, 600, 820, 1023, 1024, 1100, 1440]) {
      await atWidth(page, width, async () => {
        expect(await input.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      });
    }
  });
});

test('the Undo toast keeps a gutter on a 320px screen', async ({ page }) => {
  await open(page, 320, 640);
  const fir = page.locator('input[data-field="fir_number"]').first();
  await fir.click();
  await fir.fill('FIR-T/2026');
  await fir.dispatchEvent('input');
  await fir.dispatchEvent('change');
  await fir.blur();
  await page.waitForTimeout(900);
  await page.locator('.switch-btn').click();
  await page.locator('.history-item .row-menu-btn').first().click();
  await page.locator('#rowMenu [data-action="trash"]').click();
  const box = await page.locator('.action-toast').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(15);
  expect(box.x + box.width).toBeLessThanOrEqual(305);
});

test.describe('header placement across the two layouts', () => {
  // Mobile layout (< 1024px, tablets included): [panel+logo] [name, centred] [PDF flush right].
  test('mobile header: PDF flush right, name centred between logo and PDF', async ({ page }) => {
    await open(page, 320);
    for (const width of [320, 393, 480, 600, 768, 820, 1000, 1023]) {
      await atWidth(page, width, async () => {
        const [brand, wrap, pdf] = await Promise.all([
          page.locator('.header-brand').boundingBox(),
          page.locator('.filename-resize-wrap').boundingBox(),
          page.locator('#exportBtn').boundingBox(),
        ]);
        // PDF sits at the right edge (header padding only), never floating mid-bar.
        expect(width - (pdf.x + pdf.width)).toBeLessThanOrEqual(16);
        // The name box is centred in the gap between the logo and PDF.
        const gapMid = (brand.x + brand.width + pdf.x) / 2;
        expect(Math.abs((wrap.x + wrap.width / 2) - gapMid)).toBeLessThanOrEqual(6);
        // The formatting toolbar is not part of the mobile header.
        await expect(page.locator('#formatToolbar')).toBeHidden({ timeout: 500 });
      });
    }
  });

  // Desktop layout (>= 1024px): brand left, toolbar pill, PDF right, on one row.
  test('desktop header: one row, pill between brand and PDF, nothing clipped', async ({ page }) => {
    await open(page, 1024);
    for (const width of [1024, 1100, 1111, 1200, 1280, 1440, 1920]) {
      await atWidth(page, width, async () => {
        const [brand, tb, pdf, hdr, name] = await Promise.all([
          page.locator('.header-brand').boundingBox(),
          page.locator('#formatToolbar').boundingBox(),
          page.locator('#exportBtn').boundingBox(),
          page.locator('.header-frame').boundingBox(),
          page.locator('.filename-resize-wrap').boundingBox(),
        ]);
        // The document name box clears the toolbar (it once spilled under it).
        expect(name.x + name.width).toBeLessThanOrEqual(tb.x);
        expect(hdr.height).toBeLessThanOrEqual(80);
        expect(tb.x).toBeGreaterThanOrEqual(brand.x + brand.width);
        expect(tb.x + tb.width).toBeLessThanOrEqual(pdf.x);
        expect(pdf.x + pdf.width).toBeLessThanOrEqual(width);
        // Same vertical centre line: a single row.
        expect(Math.abs((tb.y + tb.height / 2) - (pdf.y + pdf.height / 2))).toBeLessThanOrEqual(6);
        // The pill never needs to scroll on desktop.
        expect(await page.locator('#formatToolbar').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      });
    }
  });
});
