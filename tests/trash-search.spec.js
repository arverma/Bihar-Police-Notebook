import { test, expect } from '@playwright/test';

test.describe('Sidebar search and Trash', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept());
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

  async function openSidebar(page) {
    const sidebar = page.locator('#sidebar');
    if (!(await sidebar.evaluate((el) => el.classList.contains('open')))) {
      await page.locator('.switch-btn').click();
      await expect(sidebar).toHaveClass(/open/);
    }
  }

  /** Type a FIR (which also names the document) and let autosave commit. */
  async function writeDiary(page, fir) {
    const input = page.locator('input[data-field="fir_number"]').first();
    await input.click();
    await input.fill(fir);
    await input.dispatchEvent('input');
    await input.dispatchEvent('change');
    await input.blur();
    await page.waitForTimeout(900);
  }

  async function newDiary(page) {
    await openSidebar(page);
    await page.locator('.add-template-btn').click();
    await page.waitForTimeout(200);
  }

  const rows = (page) => page.locator('.history-item');

  /** Move a History row to Trash through its "..." menu. */
  async function trashRow(page, row) {
    await row.locator('.row-menu-btn').click();
    await page.locator('#rowMenu [data-action="trash"]').click();
  }

  test('Move to Trash removes the row, Undo brings it back', async ({ page }) => {
    await writeDiary(page, 'FIR-ONE/2026');
    await openSidebar(page);
    await expect(rows(page)).toHaveCount(1);

    await trashRow(page, rows(page).first());
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#trashCount')).toHaveText('1');
    const toast = page.locator('.action-toast');
    await expect(toast).toContainText('moved to Trash');

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('#trashCount')).toBeHidden();
  });

  test('Trash dialog: restore, then delete forever', async ({ page }) => {
    await writeDiary(page, 'FIR-KEEP/2026');
    await newDiary(page);
    await writeDiary(page, 'FIR-GONE/2026');
    await openSidebar(page);
    await expect(rows(page)).toHaveCount(2);

    // Trash both.
    await trashRow(page, rows(page).first());
    await expect(rows(page)).toHaveCount(1);
    await trashRow(page, rows(page).first());
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#trashCount')).toHaveText('2');

    await page.locator('#trashBtn').click();
    const dialog = page.locator('#trashDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.trash-row')).toHaveCount(2);
    await expect(dialog.locator('[data-role="search"]')).toBeFocused();

    // Search inside Trash.
    await dialog.locator('[data-role="search"]').fill('keep');
    await expect(dialog.locator('.trash-row')).toHaveCount(1);
    await dialog.getByRole('button', { name: /^Restore/ }).click();
    await expect(dialog.locator('.trash-empty')).toContainText('No deleted documents match');
    await dialog.locator('[data-role="search"]').fill('');
    await expect(dialog.locator('.trash-row')).toHaveCount(1);

    await dialog.getByRole('button', { name: /Delete .* forever/ }).click();
    await expect(dialog.locator('.trash-empty')).toContainText('Trash is empty');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#trashBtn')).toBeFocused();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('KEEP');
  });

  test('trashing the open document starts a fresh one and never resurrects it', async ({ page }) => {
    await writeDiary(page, 'FIR-OPEN/2026');
    await openSidebar(page);
    await trashRow(page, rows(page).first());
    await expect(rows(page)).toHaveCount(0);
    // The editor now shows a blank document; wait past autosave and re-check.
    await expect(page.locator('input[data-field="fir_number"]').first()).toHaveValue('');
    await page.waitForTimeout(1500);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#trashCount')).toHaveText('1');
  });

  test('search filters by FIR, shows an empty state, and clears with Esc', async ({ page }) => {
    await writeDiary(page, 'FIR-ALPHA/2026');
    await newDiary(page);
    await writeDiary(page, 'FIR-BETA/2026');
    await openSidebar(page);
    await expect(rows(page)).toHaveCount(2);

    const search = page.locator('#historySearch');
    await search.fill('alpha');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('ALPHA');
    await expect(page.locator('#historySearchStatus')).toHaveText('1 result');
    await expect(page.locator('#historySearchClear')).toBeVisible();

    await search.fill('zzz-nothing');
    await expect(page.locator('.history-empty')).toContainText('No matches');

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#historySearchClear')).toBeHidden();
  });

  test('typing in search does not disturb the open document', async ({ page }) => {
    await writeDiary(page, 'FIR-STAY/2026');
    await openSidebar(page);
    await page.locator('#historySearch').fill('anything');
    await page.waitForTimeout(900);
    await page.locator('#historySearchClear').click();
    await expect(page.locator('input[data-field="fir_number"]').first()).toHaveValue('FIR-STAY/2026');
    await expect(rows(page)).toHaveCount(1);
  });
});
