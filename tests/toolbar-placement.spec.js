import { test, expect } from '@playwright/test';

/**
 * The format toolbar lives in the header bar on desktop (>= 1024px; a centred pill
 * with the dictation mic at its right end). On the mobile layout (<1024px) it leaves the
 * header, docks above the keyboard while an editor has focus, and the mic is
 * withdrawn for the keyboard's own (see responsive/toolbar-touch.spec.js).
 */

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  // The mobile layout shows the toolbar only while an editor has focus.
  if (width >= 1024) await expect(page.locator('#formatToolbar')).toBeVisible();
}

const box = (page, sel) => page.locator(sel).first().boundingBox();

for (const width of [1440, 1280, 1100, 1024]) {
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

test('1023px (tablet included): toolbar leaves the header, docks at the bottom once the editor has focus, and the mic is gone', async ({ page }) => {
  await open(page, 1023);
  const toolbar = page.locator('#formatToolbar');
  await expect(toolbar).toBeHidden();
  await page.locator('.editor-diary .bp-doc').first().click();
  await expect(toolbar).toBeVisible();
  const tb = await box(page, '#formatToolbar');
  expect(tb.width).toBeGreaterThanOrEqual(1022);
  expect(Math.abs(tb.y + tb.height - 900)).toBeLessThanOrEqual(1);
  await expect(page.locator('#dictationFab')).toBeHidden();
  await expect(page.locator('#punctuationToggle')).toBeHidden();
});

test('clicking the mic still starts the dictation flow', async ({ page }) => {
  await open(page, 1440);
  await page.locator('#formatToolbar .dictation-mic').click();
  // First run: the onboarding sheet opens.
  await expect(page.locator('#dictationSheet')).toHaveJSProperty('open', true);
});

test('transliteration switch lives in the toolbar and explains each state in its tooltip', async ({ page }) => {
  await open(page, 1440);
  const wrap = page.locator('#formatToolbar #translitWrap');
  await expect(wrap).toBeVisible();
  const toggle = page.locator('#translitToggle');
  await expect(toggle).toBeChecked();
  await expect(wrap.locator('.translit-glyph')).toBeVisible();
  await expect(wrap).toHaveAttribute('title', /ON.*Devanagari/);

  await page.locator('.toggle-slider').click();
  await expect(toggle).not.toBeChecked();
  await expect(wrap).toHaveAttribute('title', /OFF.*exactly as you type/);
});

test('phones: the Hinglish switch is withdrawn with the rest of the desktop typing aids', async ({ page }) => {
  await open(page, 700);
  await expect(page.locator('#translitWrap')).toBeHidden();
});
