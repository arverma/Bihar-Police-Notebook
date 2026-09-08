import { test, expect } from '@playwright/test';

/**
 * The `(max-width: 768px)` breakpoint is not just CSS — dictation-ui,
 * quill-pages, page-scale and main all branch on it at runtime via
 * matchMedia listeners. The per-device projects in tests/responsive/ pin each
 * side; this pins the *transition*, which is what silently rots when a
 * listener is dropped during a refactor.
 */

test('crossing 768px re-evaluates the mobile branch in both directions', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);

  const fabHidden = () => page.evaluate(
    () => document.getElementById('dictationFab')?.hidden,
  );

  // Desktop: the dictation FAB is available.
  expect(await fabHidden()).toBe(false);

  // Below the breakpoint the FAB is withdrawn and the engine stopped.
  await page.setViewportSize({ width: 700, height: 900 });
  await expect.poll(fabHidden).toBe(true);

  // Exactly on the breakpoint `max-width: 768px` still matches.
  await page.setViewportSize({ width: 768, height: 900 });
  await expect.poll(fabHidden).toBe(true);

  // One pixel above it does not.
  await page.setViewportSize({ width: 769, height: 900 });
  await expect.poll(fabHidden).toBe(false);

  // Returning to desktop must restore it — a one-way listener would fail here.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(fabHidden).toBe(false);
});

test('no horizontal overflow at any width across the breakpoint', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);

  for (const width of [1400, 1100, 900, 769, 768, 600, 393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    }), { message: `horizontal overflow at ${width}px` }).toBeLessThanOrEqual(1);
  }
});
