import { test, expect } from '@playwright/test';

test.describe('Transliteration Fast Typing (Quill)', () => {
  test('should transliterate correctly in Quill even when typing fast', async ({ page }) => {
    // Intercept network requests if needed or just wait for the live API
    await page.goto('/');

    // Wait for the app to initialize
    await page.waitForSelector('.editor-diary');

    // Get the right column editor (which is a Quill container)
    // The right column is the div with class fir-input and data-col="right"
    // The actual editable area for Quill is inside it with class 'ql-editor'
    const rightCol = page.locator('.editor-diary .fir-input[data-col="right"] .ql-editor').first();
    
    // Make sure Quill has been initialized
    await rightCol.waitFor({ state: 'visible' });

    // Focus and click the editor
    await rightCol.click();

    // Type 'aman' using page.keyboard.type to simulate human typing
    // A small delay ensures we trigger the native input events similar to human typing speed
    await page.keyboard.type('aman', { delay: 50 });

    // Wait a brief moment for the debounce timer (50ms) + network fetch to complete
    // We expect the suggestion box to appear, or at least the fetch to return
    // Then press space to trigger the replacement
    await page.waitForTimeout(500); 

    await page.keyboard.press('Space');

    // It should have transliterated to "अमन "
    await expect(rightCol).toHaveText(/अमन/);
    
    // Ensure it does not say 'aman'
    await expect(rightCol).not.toHaveText(/aman/);
  });
});
