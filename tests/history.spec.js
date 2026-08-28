import { test, expect } from '@playwright/test';

test.describe('History sidebar', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.editor-diary .diary-page');
    await page.evaluate(() => {
      const toggle = document.getElementById('translitToggle');
      if (toggle instanceof HTMLInputElement && toggle.checked) {
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  async function openHistorySidebar(page) {
    const sidebar = page.locator('#sidebar');
    const isOpen = await sidebar.evaluate((el) => el.classList.contains('open'));
    if (!isOpen) {
      await page.locator('.switch-btn').click();
      await expect(sidebar).toHaveClass(/open/);
    }
  }

  async function fillFirNumber(page, fir) {
    const firInput = page.locator('input[data-field="fir_number"]').first();
    await firInput.click();
    await firInput.fill(fir);
    await firInput.dispatchEvent('input');
    await firInput.dispatchEvent('change');
    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
  }

  test('clicked diary date group stays expanded after open', async ({ page }) => {
    await fillFirNumber(page, '111/2026');

    await openHistorySidebar(page);
    const activeItem = page.locator('.history-item.is-active').first();
    await expect(activeItem).toBeVisible();

    await page.evaluate(() => {
      document.querySelector('.history-item.is-active')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const group = page.locator('.history-date-group').filter({
      has: page.locator('.history-item.is-active'),
    }).first();
    await expect(group.locator('.history-items-container')).not.toHaveClass(/collapsed/);
    await expect(group.locator('.collapse-arrow')).toHaveText('▼');
  });

  test('FIR becomes document name and diary preview line is omitted', async ({ page }) => {
    const fir = 'FIR-999/2026';
    await fillFirNumber(page, fir);

    await expect(page.locator('#filenameInput')).toHaveValue(fir);

    await openHistorySidebar(page);
    const activeItem = page.locator('.history-item.is-active').first();
    await expect(activeItem.locator('.history-item-name')).toHaveText(fir);
    await expect(activeItem.locator('.history-item-preview')).toHaveCount(0);
  });

  test('manual rename is not overwritten when FIR changes', async ({ page }) => {
    await fillFirNumber(page, '100/2026');

    const customName = 'My special diary name';
    const filenameInput = page.locator('#filenameInput');
    await filenameInput.click();
    await filenameInput.fill(customName);
    await filenameInput.dispatchEvent('change');
    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);

    await fillFirNumber(page, '200/2026');
    await expect(filenameInput).toHaveValue(customName);

    await openHistorySidebar(page);
    await expect(page.locator('.history-item.is-active .history-item-name')).toHaveText(customName);
  });

  test('incremental FIR edits keep filename in sync through autosave', async ({ page }) => {
    const firInput = page.locator('input[data-field="fir_number"]').first();
    const filenameInput = page.locator('#filenameInput');

    await firInput.click();
    await firInput.fill('1234');
    await firInput.dispatchEvent('input');
    await expect(filenameInput).toHaveValue('1234');

    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await expect(filenameInput).toHaveValue('1234');

    await firInput.click();
    await firInput.fill('1234/2026');
    await firInput.dispatchEvent('input');
    await expect(filenameInput).toHaveValue('1234/2026');

    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);

    await openHistorySidebar(page);
    await expect(page.locator('.history-item.is-active .history-item-name')).toHaveText('1234/2026');
  });

  test('FIR field accepts spaces without transliteration blocking', async ({ page }) => {
    const firInput = page.locator('input[data-field="fir_number"]').first();
    await firInput.click();
    await firInput.fill('1234');
    await firInput.press(' ');
    await firInput.type('56', { delay: 20 });

    await expect(firInput).toHaveValue('1234 56');
  });
});
