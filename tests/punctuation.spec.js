import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Punctuation Panel', () => {
  test('should render exactly 9 essential punctuation buttons', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the grid to appear
    const grid = page.locator('.punctuation-grid');
    await expect(grid).toBeVisible();
    
    // Check that there are exactly 9 buttons
    const buttons = page.locator('.punctuation-grid div.punctuation-tile');
    await expect(buttons).toHaveCount(9);
  });

  test('should copy symbol to clipboard when clicked', async ({ page }) => {
    await page.goto('/');
    
    // Open the panel
    const toggleBtn = page.locator('#punctuationToggle');
    await toggleBtn.click();
    
    // Click the first punctuation button (purna viram '।')
    const firstButton = page.locator('.punctuation-grid div.punctuation-tile').first();
    const symbol = await firstButton.textContent();
    
    await firstButton.click();
    
    // Check that the clipboard contains the symbol
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(symbol.trim());
  });

  test('clicking punctuation buttons should not steal focus from the editor', async ({ page }) => {
    await page.goto('/');
    
    const editor = page.locator('.ql-editor:visible').first();
    await editor.click();
    await expect(editor).toBeFocused();
    
    // Open the panel
    const toggleBtn = page.locator('#punctuationToggle');
    await toggleBtn.click();
    
    // Click a punctuation button
    const firstButton = page.locator('.punctuation-grid div.punctuation-tile').first();
    await firstButton.click();
    
    // Focus should remain on the editor, not on the button
    await expect(editor).toBeFocused();
  });
});
