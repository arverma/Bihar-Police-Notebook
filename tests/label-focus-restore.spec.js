import { test, expect } from '@playwright/test';

test('focus restore on label', async ({ page }) => {
  await page.setContent(`
    <input type="text" id="editor">
    <label for="check" id="lbl">Toggle</label>
    <input type="checkbox" id="check">
    
    <script>
      let lastFocused = null;
      document.addEventListener('mousedown', e => {
        if (e.target.closest('label')) {
          if (document.activeElement.id === 'editor') {
            lastFocused = document.activeElement;
            e.preventDefault();
          }
        }
      });
      document.addEventListener('click', e => {
        if (lastFocused) {
          lastFocused.focus();
          lastFocused = null;
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
