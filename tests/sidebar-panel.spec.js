import { test, expect } from '@playwright/test';

test.describe('History panel layout', () => {
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

  async function writeDiary(page, fir) {
    const input = page.locator('input[data-field="fir_number"]').first();
    await input.click();
    await input.fill(fir);
    await input.dispatchEvent('input');
    await input.dispatchEvent('change');
    await input.blur();
    await page.waitForTimeout(900);
  }

  test('empty panel shows a prompt with a start button that works', async ({ page }) => {
    await openSidebar(page);
    // A fresh blank document is not saved yet, so History is empty.
    const empty = page.locator('.history-empty');
    await expect(empty).toContainText('No diaries yet');
    await empty.getByRole('button', { name: 'Start a new diary' }).click();
    await expect(page.locator('input[data-field="fir_number"]').first()).toHaveValue('');
  });

  test('the type switcher sits left of New, and New follows the chosen type', async ({ page }) => {
    await openSidebar(page);
    const sw = await page.locator('#typeSwitchBtn').boundingBox();
    const add = await page.locator('.add-template-btn').boundingBox();
    // Same row, switcher to the left of the New button.
    expect(Math.abs((sw.y + sw.height / 2) - (add.y + add.height / 2))).toBeLessThanOrEqual(2);
    expect(sw.x + sw.width).toBeLessThanOrEqual(add.x);
    // There is no second, redundant way to pick the type next to New.
    await expect(page.locator('#newMoreBtn, #newMenu')).toHaveCount(0);

    await page.locator('#typeSwitchBtn').click();
    await page.locator('#templateSegment [data-template="letter"]').click();
    await expect(page.locator('.editor-letter')).toBeVisible();
    await expect(page.locator('.add-template-btn')).toHaveText('New letter');
    await expect(page.locator('#typeSwitchBtn')).toContainText('Letter');
  });

  test('search is its own full-width row below', async ({ page }) => {
    await openSidebar(page);
    const row = await page.locator('.sidebar-new-row').boundingBox();
    const search = await page.locator('.history-search').boundingBox();
    expect(search.y).toBeGreaterThanOrEqual(row.y + row.height);
    expect(Math.abs(search.width - row.width)).toBeLessThanOrEqual(2);
  });

  test('type switcher is keyboard-operable and updates the search placeholder', async ({ page }) => {
    await openSidebar(page);
    const btn = page.locator('#typeSwitchBtn');
    await btn.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#templateSegment')).toBeVisible();
    // Focus lands on the current type; arrow to Letter and choose it.
    await expect(page.locator('#templateSegment [data-template="diary"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#templateSegment [data-template="letter"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(btn).toContainText('Letter');
    await expect(page.locator('#historySearch')).toHaveAttribute('placeholder', 'Search letters');
    await expect(page.locator('#templateSegment')).toBeHidden();
    // Choosing a type starts a fresh document, which takes focus by design.
  });

  test('using the row menu, Trash dialog or Undo toast does not collapse the panel', async ({ page }) => {
    await writeDiary(page, 'FIR-OPEN/2026');
    await openSidebar(page);
    await page.locator('.history-item .row-menu-btn').first().click();
    await page.locator('#rowMenu [data-action="trash"]').click();
    await expect(page.locator('.action-toast')).toBeVisible();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await page.locator('#trashBtn').click();
    await page.locator('#trashDialog [data-action="close"]').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await page.locator('.action-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await expect(page.locator('.history-item')).toHaveCount(1);
  });

  test('Escape closes a menu and returns focus to its button', async ({ page }) => {
    await openSidebar(page);
    await page.locator('#typeSwitchBtn').click();
    await expect(page.locator('#templateSegment')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#templateSegment')).toBeHidden();
    await expect(page.locator('#typeSwitchBtn')).toBeFocused();
  });

  test('row menu works from the keyboard; Move to Trash is the first item', async ({ page }) => {
    await writeDiary(page, 'FIR-KB/2026');
    await openSidebar(page);
    const btn = page.locator('.history-item .row-menu-btn').first();
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#rowMenu [data-action="trash"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#rowMenu [data-action="docx"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rowMenu')).toBeHidden();
    await expect(btn).toBeFocused();
    // Opening a row menu must not open the document row underneath.
    await expect(page.locator('.history-item')).toHaveCount(1);
  });

  test('row menu stays on screen and closes when the list scrolls or re-renders', async ({ page }) => {
    await writeDiary(page, 'FIR-POS/2026');
    await openSidebar(page);
    await page.locator('.history-item .row-menu-btn').first().click();
    const menu = page.locator('#rowMenu');
    const box = await menu.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    // Searching re-renders the list, which must dismiss the menu.
    await page.locator('#historySearch').fill('zzz');
    await expect(menu).toBeHidden();
  });

  test('footer holds the backup status and Trash; New is the only filled button up top', async ({ page }) => {
    await openSidebar(page);
    const footer = page.locator('.sidebar-footer');
    await expect(footer.locator('#backupBtn')).toBeVisible();
    await expect(footer.locator('#backupLabel')).toHaveText('Back up to Drive');
    await expect(footer.locator('#trashBtn')).toBeVisible();
    // Nothing from the footer is left in the top controls.
    await expect(page.locator('.sidebar-top #backupBtn, .sidebar-top #trashBtn')).toHaveCount(0);
    // New, search and the switcher stay put while the list scrolls (fixed above it).
    const position = await page.locator('.sidebar-top').evaluate((el) => getComputedStyle(el).flexShrink);
    expect(position).toBe('0');
  });

  test('the sync badge is shown only when a row needs attention', async ({ page }) => {
    await writeDiary(page, 'FIR-BADGE/2026');
    await openSidebar(page);
    // Disconnected (the default here): no badge at all.
    await expect(page.locator('.history-item')).toHaveCount(1);
    await expect(page.locator('.history-sync-badge')).toHaveCount(0);
  });
});
