import { test, expect } from '@playwright/test';

const SPACED_TEXT = '   सेंटर  word';

test.describe('Quill space preservation', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.editor-diary .diary-page .ql-editor');
    await page.evaluate(() => {
      const toggle = document.getElementById('translitToggle');
      if (toggle instanceof HTMLInputElement && toggle.checked) {
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  async function fillDiaryRightColumn(page, text) {
    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el, value) => {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
    }, text);
    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }

  async function readDiaryRightText(page) {
    return page.locator('.editor-diary .diary-page .ql-editor').first().evaluate(
      (el) => el.textContent || '',
    );
  }

  test('leading and double spaces survive page reload', async ({ page }) => {
    await fillDiaryRightColumn(page, SPACED_TEXT);
    await page.reload();
    await page.waitForSelector('.editor-diary .diary-page .ql-editor');
    const text = await readDiaryRightText(page);
    expect(text).toBe(SPACED_TEXT);
  });

  async function openHistorySidebar(page) {
    const sidebar = page.locator('#sidebar');
    const isOpen = await sidebar.evaluate((el) => el.classList.contains('open'));
    if (!isOpen) {
      await page.locator('.switch-btn').click();
      await expect(sidebar).toHaveClass(/open/);
    }
  }

  test('leading and double spaces survive history reopen', async ({ page }) => {
    await fillDiaryRightColumn(page, SPACED_TEXT);

    await openHistorySidebar(page);

    page.once('dialog', (dialog) => dialog.accept());
    await page.evaluate(() => {
      document.querySelector('.add-template-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    await expect(page.locator('.history-item').first()).toBeVisible();
    await page.evaluate(() => {
      document.querySelector('.history-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const text = await readDiaryRightText(page);
    expect(text).toBe(SPACED_TEXT);
  });
});
