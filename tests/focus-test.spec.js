import { test, expect } from '@playwright/test';

test('retains focus when clicking buttons', async ({ page }) => {
  await page.goto('/');
  
  // Wait for editor
  const editor = page.locator('.ql-editor:visible').first();
  const editor = page.locator('.ql-editor').first();
  await editor.click();
  await editor.type('Hello');
  
  // Evaluate the active element
  const activeElementClass = await page.evaluate(() => document.activeElement.className);
  console.log("Active element class:", activeElementClass);
  
  // Click toggle
  const slider = page.locator('.toggle-slider');
  await slider.click();
  
  // Verify toggle state changed
  const toggle = page.locator('#translitToggle');
  await expect(toggle).not.toBeChecked();
  
  // Wait for focus to return to editor (handled by setTimeout in main.js)
  await expect(editor).toBeFocused();
});
