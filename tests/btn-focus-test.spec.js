import { test, expect } from '@playwright/test';

test('focus transfer on button', async ({ page }) => {
  await page.setContent(`
    <input type="text" id="editor">
    <button id="btn">Button</button>
    
    <script>
      document.addEventListener('mousedown', e => {
        if (e.target.closest('button')) {
          e.preventDefault();
        }
      });
    </script>
  `);
  
  await page.locator('#editor').focus();
  await page.locator('#btn').click();
  
  const focusedId = await page.evaluate(() => document.activeElement.id);
  
  console.log("Focused ID:", focusedId);
});
