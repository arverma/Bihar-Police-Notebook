import { test, expect } from '@playwright/test';
import { openFresh, setCaret, settle, switchTemplate } from './pagination-helpers.js';

/**
 * On load the app reopens the last document; without one it opens the top of
 * History; it starts a new document only when History has nothing to open.
 */

/** Save a diary straight into IndexedDB. */
async function saveDiary(page, filename, text, createdAt) {
  return page.evaluate(async ({ f, t, c }) => {
    const { serializeDoc } = await import('/js/editor/doc-format.js');
    const { emptyDiaryJSON } = await import('/js/editor/schema.js');
    const doc = emptyDiaryJSON();
    doc.content[0].content[1].content = [{ type: 'paragraph', content: [{ type: 'text', text: t }] }];
    const store = await import('/js/document-store.js');
    return store.saveDocumentById('diary', { id: null, filename: f, content: serializeDoc(doc), created_at: c });
  }, { f: filename, t: text, c: createdAt });
}

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => window.__uxInitComplete === true);
  await settle(page);
}

const openText = (page) => page.evaluate(() => window.__bpTest.cellText(0, 'right'));

test.describe('Document opened on load', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
  });

  test('reopens the document that was open last, not the newest one', async ({ page }) => {
    await saveDiary(page, 'Older', 'older diary', '2026-09-01T10:00:00Z');
    await saveDiary(page, 'Newer', 'newer diary', '2026-10-01T10:00:00Z');
    await reload(page);
    await page.locator('.switch-btn').click();
    // Older documents sit in a collapsed date group until it is expanded.
    const group = page.locator('.history-date-group', { has: page.locator('.history-item', { hasText: 'Older' }) });
    await group.locator('.date-header').click();
    await group.locator('.history-item', { hasText: 'Older' }).click();
    await expect.poll(() => openText(page)).toBe('older diary');

    await reload(page);
    expect(await openText(page)).toBe('older diary');
    await expect(page.locator('#filenameInput')).toHaveValue('Older');
  });

  test('without a last document, opens the top of History', async ({ page }) => {
    await saveDiary(page, 'Older', 'older diary', '2026-09-01T10:00:00Z');
    await saveDiary(page, 'Newer', 'newer diary', '2026-10-01T10:00:00Z');
    await page.evaluate(() => localStorage.removeItem('lastActiveDocId'));
    await reload(page);
    expect(await openText(page)).toBe('newer diary');
    // It is the row shown at the top of History.
    await page.locator('.switch-btn').click();
    await expect(page.locator('.history-item').first().locator('.history-item-name')).toHaveText('Newer');
    await expect(page.locator('.history-item').first()).toHaveClass(/is-active/);
  });

  test('a deleted last document falls back to the top of History', async ({ page }) => {
    const id = await saveDiary(page, 'Gone', 'gone', '2026-10-05T10:00:00Z');
    await saveDiary(page, 'Kept', 'kept diary', '2026-09-01T10:00:00Z');
    await page.evaluate(async (docId) => {
      localStorage.setItem('lastActiveDocId', String(docId));
      localStorage.setItem('lastActiveDocType', 'diary');
      const store = await import('/js/document-store.js');
      await store.softDeleteDocumentById('diary', docId);
    }, id);
    await reload(page);
    expect(await openText(page)).toBe('kept diary');
  });

  test('older-format documents are skipped; the newest one that opens is used', async ({ page }) => {
    await saveDiary(page, 'Current', 'current diary', '2026-09-01T10:00:00Z');
    await page.evaluate(async () => {
      const store = await import('/js/document-store.js');
      await store.saveDocumentById('diary', { id: null, filename: 'Old', content: '<p>legacy</p>', created_at: '2026-12-01T10:00:00Z' });
      localStorage.removeItem('lastActiveDocId');
    });
    await reload(page);
    expect(await openText(page)).toBe('current diary');
    await expect(page.locator('#unsupportedDocDialog')).toBeHidden();
  });

  test('starts a new document only when History is empty', async ({ page }) => {
    await reload(page);
    expect(await openText(page)).toBe('');
    await page.locator('.switch-btn').click();
    await expect(page.locator('.history-empty')).toBeVisible();
  });

  test('restores the letter template when a letter was open last', async ({ page }) => {
    await switchTemplate(page, 'letter');
    await setCaret(page, { page: 0, col: 'main' }, 'letter');
    await page.keyboard.insertText('पत्र का पाठ');
    await page.waitForTimeout(900); // autosave
    await reload(page);
    await expect(page.locator('.editor-letter')).toBeVisible();
    expect(await page.evaluate(() => window.__bpTest.cellText(0, 'main', 'letter'))).toBe('पत्र का पाठ');
  });
});
