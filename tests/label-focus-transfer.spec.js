import { test, expect } from '@playwright/test';

test('focus transfer on label', async ({ page }) => {
  await page.setContent(`
    <input type="text" id="editor">
    <label for="check" id="lbl">Toggle</label>
    <input type="checkbox" id="check">
    
    <script>
      document.addEventListener('mousedown', e => {
        if (e.target.closest('label')) {
          e.preventDefault();
        }
      });
    </script>
  `);
  
  await page.locator('#editor').focus();
  await page.locator('#lbl').click();
  
  const checked = await page.locator('#check').isChecked();
  const focusedId = await page.evaluate(() => document.activeElement.id);
  
  console.log("Checked:", checked);
  console.log("Focused ID:", focusedId);
});
