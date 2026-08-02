import { test, expect } from '@playwright/test';

test('retains focus when clicking buttons', async ({ page }) => {
  await page.goto('/');
  
  // Wait for editor
  const editor = page.locator('.ql-editor').first();
  await editor.click();
  await editor.type('Hello');
  
  // Evaluate the active element
  const activeElementClass = await page.evaluate(() => document.activeElement.className);
  console.log("Active element class:", activeElementClass);
  
  // Click toggle
  const slider = page.locator('.toggle-slider');
  await slider.click();
  
  // Verify toggle state changed but focus is still in editor
  const toggle = page.locator('#translitToggle');
  await expect(toggle).not.toBeChecked();
  
  const postActiveElementClass = await page.evaluate(() => document.activeElement.className);
  console.log("Post Active element class:", postActiveElementClass);
  
  expect(postActiveElementClass).toContain('ql-editor');
});
