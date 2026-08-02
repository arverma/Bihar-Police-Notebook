import { test, expect } from '@playwright/test';

test('toggle state is preserved across reloads', async ({ page }) => {
  // Go to page
  await page.goto('/');
  
  // Wait for toggle
  const toggle = page.locator('#translitToggle');
  const slider = page.locator('.toggle-slider');
  
  // Default should be checked
  await expect(toggle).toBeChecked();
  
  // Click to uncheck
  await slider.click();
  await expect(toggle).not.toBeChecked();
  
  // Reload
  await page.reload();
  
  // Should still be unchecked
  await expect(toggle).not.toBeChecked();
  
  // Click to check again
  await slider.click();
  await expect(toggle).toBeChecked();
  
  // Reload
  await page.reload();
  
  // Should still be checked
  await expect(toggle).toBeChecked();
});
