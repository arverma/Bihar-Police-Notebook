import { test, expect } from '@playwright/test';

// The mobile header is [brand] [filename] [PDF]. The name box used to be capped
// at ~110px even with ~270px free, so ordinary names were cut off.
test('document name uses the free header width on small screens', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.editor-diary .diary-page');

  const input = page.locator('#filenameInput');
  await input.fill('10 Nov 2026 · FIR 123/2026');
  await input.dispatchEvent('input');

  const wrap = await page.locator('.filename-resize-wrap').boundingBox();
  const pdf = await page.locator('#exportBtn').boundingBox();
  const brand = await page.locator('.header-brand').boundingBox();

  expect(await input.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Stays between the brand and the PDF button.
  expect(wrap.x).toBeGreaterThanOrEqual(brand.x + brand.width);
  expect(wrap.x + wrap.width).toBeLessThanOrEqual(pdf.x);

  // A name too long for the row fills it, then truncates inside it.
  await input.fill('10 Nov 2026 · FIR 123/2026 · a very long case name that cannot fit');
  await input.dispatchEvent('input');
  const long = await page.locator('.filename-resize-wrap').boundingBox();
  expect(long.width).toBeGreaterThan(200);
  expect(long.x + long.width).toBeLessThanOrEqual(pdf.x);
});
