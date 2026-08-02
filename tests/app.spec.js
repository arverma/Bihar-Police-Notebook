import { test, expect } from '@playwright/test';

test.describe('Bihar Police Notebook', () => {

  test.beforeEach(async ({ page }) => {
    // Go to the local app
    await page.goto('/');
  });

  test('should load the application and have correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Bihar Police Notebook/);
  });

  test('should toggle phonetic transliteration', async ({ page }) => {
    // Get the toggle checkbox
    const translitToggle = page.locator('#translitToggle');
    const slider = page.locator('.toggle-slider');
    
    // It should initially be checked (transliteration ON, isHindiMode = false)
    await expect(translitToggle).toBeChecked();
    
    // Click the toggle slider
    await slider.click();
    
    // It should become unchecked
    await expect(translitToggle).not.toBeChecked();
  });

});
