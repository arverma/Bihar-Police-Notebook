import { test, expect } from '@playwright/test';

/**
 * The format toolbar lives in the header bar on desktop/tablet (a centred pill
 * with the dictation mic at its right end) and drops to its own row under the
 * bar on phones (<=768px, where the mic is withdrawn for the keyboard's own).
 */

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  await expect(page.locator('#formatToolbar')).toBeVisible();
}

const box = (page, sel) => page.locator(sel).first().boundingBox();

for (const width of [1440, 1100, 900, 769]) {
  test(`${width}px: toolbar shares the top bar row with brand and PDF`, async ({ page }) => {
    await open(page, width);
    const [bar, tb, brand, pdf] = await Promise.all([
      box(page, '.header-content'),
      box(page, '#formatToolbar'),
      box(page, '.header-brand'),
      box(page, '#exportBtn'),
    ]);
    // Inside the bar's vertical extent (one row), between brand and PDF.
    expect(tb.y).toBeGreaterThanOrEqual(bar.y);
    expect(tb.y + tb.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    expect(tb.x).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(tb.x + tb.width).toBeLessThanOrEqual(pdf.x + 1);
    // The header is a single row, so the page starts right under it.
    expect(bar.height).toBeLessThan(80);
  });

  test(`${width}px: the mic is the last control inside the toolbar`, async ({ page }) => {
    await open(page, width);
    const mic = page.locator('#formatToolbar .dictation-mic');
    await expect(mic).toBeVisible();
    const [tb, m, punct] = await Promise.all([
      box(page, '#formatToolbar'),
      box(page, '#formatToolbar .dictation-mic'),
      box(page, '#punctuationToggle'),
    ]);
    expect(m.x).toBeGreaterThan(punct.x);
    expect(m.x + m.width).toBeLessThanOrEqual(tb.x + tb.width + 1);
    // No sideways page scroll.
    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(spill).toBeLessThanOrEqual(1);
  });
}

test('there is no floating mic any more', async ({ page }) => {
  await open(page, 1440);
  const pos = await page.locator('#dictationFab').evaluate((el) => getComputedStyle(el).position);
  expect(pos).not.toBe('fixed');
  expect(await page.locator('#dictationFab').evaluate((el) => el.closest('#formatToolbar') !== null)).toBe(true);
});

test('768px: toolbar is its own row under the bar and the mic is gone', async ({ page }) => {
  await open(page, 768);
  const [brand, tb] = await Promise.all([box(page, '.header-brand'), box(page, '#formatToolbar')]);
  expect(tb.y).toBeGreaterThanOrEqual(brand.y + brand.height);
  expect(tb.width).toBeGreaterThanOrEqual(767);
  await expect(page.locator('#dictationFab')).toBeHidden();
  await expect(page.locator('#punctuationToggle')).toBeHidden();
});

test('clicking the mic still starts the dictation flow', async ({ page }) => {
  await open(page, 1440);
  await page.locator('#formatToolbar .dictation-mic').click();
  // First run: the onboarding sheet opens.
  await expect(page.locator('#dictationSheet')).toHaveJSProperty('open', true);
});
