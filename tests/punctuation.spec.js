import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Punctuation Panel', () => {
  test('should render exactly 9 essential punctuation buttons', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('#punctuationToggle').click();
    const grid = page.locator('.punctuation-grid');
    await expect(grid).toBeVisible();
    
    // Check that there are exactly 9 buttons
    const buttons = page.locator('.punctuation-grid .punctuation-tile');
    await expect(buttons).toHaveCount(9);
  });

  test('should copy symbol to clipboard when clicked', async ({ page }) => {
    await page.goto('/');
    
    // Open the panel
    const toggleBtn = page.locator('#punctuationToggle');
    await toggleBtn.click();
    
    // Click the first punctuation button (purna viram '।')
    const firstButton = page.locator('.punctuation-grid .punctuation-tile').first();
    const symbol = await firstButton.textContent();
    
    await firstButton.click();
    
    // Check that the clipboard contains the symbol
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(symbol.trim());
  });

  test('clicking punctuation buttons should not steal focus from the editor', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.editor-diary .bp-cell[data-col="right"]').first().click();
    const editor = page.locator('.editor-diary .bp-doc');
    await expect(editor).toBeFocused();
    
    // Open the panel
    const toggleBtn = page.locator('#punctuationToggle');
    await toggleBtn.click();
    
    // Click a punctuation button
    const firstButton = page.locator('.punctuation-grid .punctuation-tile').first();
    await firstButton.click();
    
    // Focus should remain on the editor, not on the button
    await expect(editor).toBeFocused();
  });

  test('a mark is inserted at the caret; Escape closes the panel', async ({ page }) => {
    await page.goto('/');
    await page.locator('.editor-diary .bp-cell[data-col="right"]').first().click();
    const editor = page.locator('.editor-diary .bp-doc');
    await page.locator('#translitToggle').evaluate((el) => { if (el.checked) el.click(); });
    await editor.pressSequentially('abc');
    await page.locator('#punctuationToggle').click();
    await expect(page.locator('#punctuationToggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.punctuation-tile', { hasText: '।' }).first().click();
    await expect(page.locator('.editor-diary .bp-cell[data-col="right"]').first()).toContainText('abc।');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#punctuationPanel')).not.toHaveClass(/is-open/);
  });
});
