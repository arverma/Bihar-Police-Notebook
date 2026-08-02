import { test, expect } from '@playwright/test';

test('mousedown preventDefault on checkbox', async ({ page }) => {
  await page.setContent(`
    <label class="toggle-switch">
      <input type="checkbox" id="test-check">
      <span class="slider">Toggle</span>
    </label>
    <script>
      const label = document.querySelector('label');
      label.addEventListener('mousedown', e => e.preventDefault());
    </script>
  `);
  
  const checkbox = page.locator('#test-check');
  const slider = page.locator('.slider');
  
  await expect(checkbox).not.toBeChecked();
  await slider.click(); // This fires mousedown then click
  await expect(checkbox).toBeChecked();
});
