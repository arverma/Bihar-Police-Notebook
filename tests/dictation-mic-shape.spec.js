import { test, expect } from '@playwright/test';

// The mic is round (border-radius: 50%), so any width/height mismatch shows as
// an oval. It only exists on the desktop layout (>= 1024px).
for (const width of [1024, 1100, 1200, 1440]) {
  test(`dictation mic stays a circle at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForSelector('.editor-diary .diary-page');
    const mic = page.locator('.dictation-mic');
    test.skip(!(await mic.isVisible()), 'dictation is not offered in this browser');
    const box = await mic.boundingBox();
    expect(box.width).toBe(box.height);
  });
}
