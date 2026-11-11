import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { openFresh } from './pagination-helpers.js';

/**
 * Word export from the History sidebar: every row has a "..." menu with a Download
 * Word item, which
 * downloads a real .docx — of the live editor for the open document, of the
 * stored copy (without opening it) for any other row.
 */

async function openSidebar(page) {
  if (!(await page.locator('#sidebar').evaluate((el) => el.classList.contains('open')))) {
    await page.locator('.switch-btn').click();
  }
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
}

/** Open a row's "..." menu, choose Download Word and read the downloaded file. */
async function downloadDocx(page, row) {
  await row.locator('.row-menu-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#rowMenu [data-action="docx"]').click(),
  ]);
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  return { name: download.suggestedFilename(), xml: await zip.file('word/document.xml').async('string') };
}

/** Type an FIR number through the UI so autosave stores the document as a History row. */
async function fillFir(page, fir) {
  const input = page.locator('input[data-field="fir_number"]').first();
  await input.click();
  await input.fill(fir);
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
  await input.blur();
  await page.waitForTimeout(900);
}

test('the open document: its row exports the live editor content', async ({ page }) => {
  await openFresh(page);
  await fillFir(page, '111/2026');
  await openSidebar(page);
  const row = page.locator('.history-item.is-active');
  await expect(row).toHaveCount(1, { timeout: 10_000 });

  const { name, xml } = await downloadDocx(page, row);
  expect(name).toMatch(/\.docx$/);
  expect(xml).toContain('111/2026');
});

test('another row exports its own stored content and does not open it', async ({ page }) => {
  await openFresh(page);
  await fillFir(page, '111/2026');
  await openSidebar(page);
  await expect(page.locator('.history-item')).toHaveCount(1, { timeout: 10_000 });

  // Start a second document; the first is now a different row.
  page.once('dialog', (d) => { void d.accept(); });
  await page.locator('.add-template-btn').click();
  await fillFir(page, '222/2026');
  await openSidebar(page); // starting a document may close the panel
  await expect(page.locator('.history-item')).toHaveCount(2, { timeout: 10_000 });

  const other = page.locator('.history-item:not(.is-active)');
  await expect(other).toHaveCount(1);
  const { xml } = await downloadDocx(page, other);
  expect(xml).toContain('111/2026');
  expect(xml).not.toContain('222/2026');
  // Exporting did not switch documents.
  await expect(page.locator('.history-item.is-active')).toHaveCount(1);
  await expect(page.locator('input[data-field="fir_number"]').first()).toHaveValue('222/2026');
});

test('row menu button is visible without hovering and offers Word and Trash', async ({ page }) => {
  await openFresh(page);
  await fillFir(page, '111/2026');
  await openSidebar(page);
  const row = page.locator('.history-item').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const btn = row.locator('.row-menu-btn');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(32);
  expect(box.height).toBeGreaterThanOrEqual(32);
  expect(await btn.evaluate((el) => getComputedStyle(el.parentElement).opacity)).toBe('1');
  // The old per-row icons are gone.
  await expect(row.locator('.docx-btn, .delete-btn')).toHaveCount(0);

  await btn.click();
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[role="menuitem"]:visible')).toHaveText(['Move to Trash', 'Download Word']);
});

test('History panel: one New button, a type switcher, and a text backup status', async ({ page }) => {
  await openFresh(page);
  await openSidebar(page);
  await expect(page.locator('.sidebar-header h3, .sidebar-subtitle')).toHaveCount(0);
  await expect(page.locator('.add-template-btn')).toHaveText('New diary');
  await expect(page.locator('#typeSwitchBtn')).toContainText('Diary');
  await page.locator('#typeSwitchBtn').click();
  await page.locator('#templateSegment [data-template="letter"]').click();
  await expect(page.locator('.add-template-btn')).toHaveText('New letter');
  await expect(page.locator('#typeSwitchBtn')).toContainText('Letter');

  // Backup state is words in the footer, not a coloured dot: every state has a label.
  const labels = await page.evaluate(() => {
    const btn = document.getElementById('backupBtn');
    const label = document.getElementById('backupLabel');
    return { btnInFooter: Boolean(btn.closest('.sidebar-footer')), text: label.textContent.trim() };
  });
  expect(labels.btnInFooter).toBe(true);
  expect(labels.text).toBe('Back up to Drive');
  await expect(page.locator('#backupBtn')).toHaveAttribute('aria-label', 'Connect to back up');
});

test('the PDF button is unchanged', async ({ page }) => {
  await openFresh(page);
  await expect(page.locator('#exportBtn')).toHaveAttribute('title', 'Print or save as PDF');
  await expect(page.locator('#exportDocxBtn')).toHaveCount(0);
});
