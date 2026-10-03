import { test, expect } from '@playwright/test';
import { openFresh } from './pagination-helpers.js';

/**
 * Documents this version cannot open stay listed in History, never mount the
 * editor, and can be deleted (locally and from Drive backup) from a dialog.
 */

const LEGACY_DIARY = JSON.stringify({ pages: [{ hasHeader: true, header: { fir_number: '9/24' }, left: 'old', right: '<p>old</p>' }] });

/** Seed documents straight into IndexedDB, then reload so the app sees them. */
async function seed(page, docs, { resetNotice = true } = {}) {
  await page.evaluate(async ({ list, reset }) => {
    const store = await import('/js/document-store.js');
    for (const d of list) {
      await store.saveDocumentById(d.type ?? 'diary', {
        id: null, filename: d.filename, content: d.content, created_at: new Date().toISOString(),
      });
    }
    if (reset) localStorage.removeItem('bpnt.unsupportedDocs.noticeShown');
  }, { list: docs, reset: resetNotice });
  await page.reload();
  await page.waitForFunction(() => window.__uxInitComplete === true);
}

async function openHistory(page) {
  await page.locator('.switch-btn').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
}

const rowsNamed = (page, name) => page.locator('.history-item', { has: page.locator('.history-item-name', { hasText: name }) });

test.describe('Documents this version cannot open', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
  });

  test('are badged in History and open a dialog instead of the editor', async ({ page }) => {
    await seed(page, [{ filename: 'Old diary A', content: LEGACY_DIARY }]);
    await openHistory(page);
    const row = rowsNamed(page, 'Old diary A');
    await expect(row.locator('.history-item-badge')).toHaveText('Older format');

    const before = await page.evaluate(() => window.__bpTest.content());
    await row.click();
    const dialog = page.locator('#unsupportedDocDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Old diary A');
    // Safe default focus: a stray Enter keeps the document.
    await expect(dialog.locator('[data-action="keep"]')).toBeFocused();
    // The open document was not replaced.
    expect(await page.evaluate(() => window.__bpTest.content())).toBe(before);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
    await expect(row).toBeFocused();
  });

  test('Delete removes the document; nothing of it stays in the browser', async ({ page }) => {
    await seed(page, [{ filename: 'Old diary A', content: LEGACY_DIARY }]);
    await openHistory(page);
    await rowsNamed(page, 'Old diary A').click();
    await page.locator('#unsupportedDocDialog [data-action="delete"]').click();
    await expect(rowsNamed(page, 'Old diary A')).toHaveCount(0);
    await expect(page.locator('.restore-message')).toContainText('Document deleted');
    const rows = await page.evaluate(async () => {
      const store = await import('/js/document-store.js');
      return (await store.getDocumentsIncludingDeleted('diary')).filter((d) => d.filename === 'Old diary A');
    });
    // Never backed up, so it is purged outright.
    expect(rows).toEqual([]);
  });

  test('a backed-up document leaves a tombstone with its old content purged', async ({ page }) => {
    await seed(page, [{ filename: 'Synced old', content: LEGACY_DIARY }]);
    // Pretend it was backed up, so deletion must leave a tombstone for Drive.
    await page.evaluate(async () => {
      const store = await import('/js/document-store.js');
      const doc = (await store.getDocuments('diary')).find((d) => d.filename === 'Synced old');
      await store.markSynced('diary', doc.id, { driveFileId: 'drive-123', syncedAt: doc.updated_at });
    });
    await page.reload();
    await page.waitForFunction(() => window.__uxInitComplete === true);
    await openHistory(page);
    await rowsNamed(page, 'Synced old').click();
    await page.locator('#unsupportedDocDialog [data-action="delete"]').click();
    await expect(rowsNamed(page, 'Synced old')).toHaveCount(0);
    const tomb = await page.evaluate(async () => {
      const store = await import('/js/document-store.js');
      return (await store.getDocumentsIncludingDeleted('diary')).find((d) => d.filename === 'Synced old');
    });
    expect(tomb.deletedAt).toBeTruthy();
    expect(tomb.content).toBe('');
    expect(tomb.uuid).toBeTruthy();
  });

  test('"Delete all" removes every older document at once', async ({ page }) => {
    await seed(page, [
      { filename: 'Old A', content: LEGACY_DIARY },
      { filename: 'Old B', content: '<p>legacy html</p>' },
      { filename: 'Old C', content: 'plain text' },
    ]);
    await openHistory(page);
    await rowsNamed(page, 'Old A').click();
    const all = page.locator('#unsupportedDocDialog [data-action="delete-all"]');
    await expect(all).toHaveText('Delete all 3 older documents');
    await all.click();
    await expect(page.locator('.history-item[data-unsupported]')).toHaveCount(0);
  });

  test('a one-time notice on launch offers to review them', async ({ page }) => {
    await seed(page, [{ filename: 'Old A', content: LEGACY_DIARY }]);
    const notice = page.locator('.unsupported-notice');
    await expect(notice).toContainText('1 older document can’t be opened');
    await notice.getByRole('button', { name: 'Review' }).click();
    await expect(page.locator('#unsupportedDocDialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.reload();
    await page.waitForFunction(() => window.__uxInitComplete === true);
    await page.waitForTimeout(500);
    await expect(page.locator('.unsupported-notice')).toHaveCount(0);
  });

  test('a damaged document in the current format is refused, not mounted', async ({ page }) => {
    const damaged = JSON.stringify({ format: 'bp-doc', v: 1, doc: { type: 'doc', content: [{ type: 'diaryPage', content: [] }] } });
    await seed(page, [{ filename: 'Broken', content: damaged }], { resetNotice: false });
    await openHistory(page);
    await rowsNamed(page, 'Broken').click();
    const dialog = page.locator('#unsupportedDocDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('is damaged');
    await expect(page.locator('.editor-diary .diary-page')).toHaveCount(1);
  });
});
