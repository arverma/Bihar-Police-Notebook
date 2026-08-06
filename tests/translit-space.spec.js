import { test, expect } from '@playwright/test';

test.describe('Transliteration Space Insertion', () => {
  test('should insert space correctly in the middle of a Hindi word', async ({ page }) => {
    // Mock the Google Input Tools API request
    await page.route('https://inputtools.google.com/request*', async route => {
      const url = new URL(route.request().url());
      const text = url.searchParams.get('text');
      
      // If the word is "जीवनजीना", return it as the suggestion to simulate the scenario
      if (text === 'जीवनजीना') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            'SUCCESS',
            [[text, [text], [], { candidate_type: [0] }]]
          ])
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            'SUCCESS',
            [[text, [text], [], { candidate_type: [0] }]]
          ])
        });
      }
    });

    await page.goto('/');

    // Get the visible textarea editor element in the diary layout
    const editor = page.locator('.editor-diary textarea.fir-input').first();

    // Type text directly into the editor
    await editor.click();
    await editor.fill('जीवनजीना');
    
    // Position cursor in the middle between 'न' (index 3) and 'ज' (index 4)
    await editor.evaluate((el) => {
      el.focus();
      el.selectionStart = 4;
      el.selectionEnd = 4;
    });

    // Press Space
    await editor.press('Space');

    // Verify that the space was inserted in the middle, not at the end
    await expect(editor).toHaveValue('जीवन जीना');
  });
});
