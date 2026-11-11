import { test, expect } from '@playwright/test';

// Phone formatting bar: docked above the keyboard (bottom edge of the visual
// viewport), shown only while a document editor has focus, with keys the size
// of iOS letter keys, scrolling sideways rather than shrinking them.
async function gotoDiary(page) {
  await page.goto('/');
  await page.waitForSelector('.editor-diary .diary-page');
}

const editor = (page) => page.locator('.editor-diary .bp-doc').first();

test('formatting bar is hidden until an editor has focus, then docks at the bottom', async ({ page }) => {
  await gotoDiary(page);
  const toolbar = page.locator('#formatToolbar');

  await expect(toolbar).toBeHidden();

  await editor(page).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveClass(/is-docked/);

  const vh = page.viewportSize().height;
  const box = await toolbar.boundingBox();
  expect(Math.abs(box.y + box.height - vh)).toBeLessThanOrEqual(1);
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(page.viewportSize().width);

  // Tapping outside the editor takes the bar away again.
  await page.locator('.header-brand').click();
  await expect(toolbar).toBeHidden();
});

test('a plain header field does not raise the bar', async ({ page }) => {
  await gotoDiary(page);
  await page.locator('input[data-field="fir_number"]').first().click();
  await expect(page.locator('#formatToolbar')).toBeHidden();
});

test('using a bar button keeps the bar up and the editor focused', async ({ page }) => {
  await gotoDiary(page);
  await editor(page).click();
  await page.locator('#formatToolbar [data-cmd="bold"]').click();
  await expect(page.locator('#formatToolbar')).toBeVisible();
  await expect(page.locator('#formatToolbar [data-cmd="bold"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.bp-doc')))).toBe(true);
});

test('buttons are 40px touch targets (not bigger) and every one is reachable', async ({ page }) => {
  await gotoDiary(page);
  await editor(page).click();
  const toolbar = page.locator('#formatToolbar');
  // The bar docks on the next animation frame after the tap; count() does not wait.
  await expect(toolbar).toBeVisible();
  const buttons = toolbar.locator('button:visible');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(9);

  // 40px touch targets: big enough to tap, small enough to keep the bar one short row.
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(36);
    expect(box.width, `button ${i} width`).toBeLessThanOrEqual(44);
    expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(40);
    expect(box.height, `button ${i} height`).toBeLessThanOrEqual(44);
  }
  expect(await toolbar.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');

  // The whole bar is one short row, like a keyboard's top row.
  const bar = await toolbar.boundingBox();
  expect(bar.height).toBeLessThanOrEqual(60);

  const last = buttons.nth(count - 1);
  await last.scrollIntoViewIfNeeded();
  const lastBox = await last.boundingBox();
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  expect(lastBox.x).toBeGreaterThanOrEqual(bar.x - 1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
