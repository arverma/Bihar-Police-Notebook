import { test, expect } from '@playwright/test';

/**
 * Clicking header / sidebar chrome must never steal the caret from the document:
 * main.js preventDefaults the mousedown and restores focus after the click.
 *
 * The editor mixes three field types and the handler has silently missed one
 * before, so every type is asserted here rather than just the Quill body.
 *
 * Replaces five earlier specs that rebuilt this behaviour in a `setContent`
 * fixture — they exercised Chromium's event model, not this app, and four of
 * them carried no assertions at all.
 */

const FIELDS = [
  { name: 'Quill body', selector: '.editor-diary .ql-editor:visible' },
  { name: 'header input (थाना)', selector: '[data-field="thana"]' },
  { name: 'header contenteditable (धारा)', selector: '[data-field="sections"]' },
];

const CHROME = [
  { name: 'transliteration toggle', selector: '.toggle-slider' },
  { name: 'punctuation panel tile', selector: '.punctuation-grid div.punctuation-tile' },
];

async function gotoDiary(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete);
  await expect(page.locator('.diary-page').first()).toBeVisible();
}

test.describe('Focus retention when clicking chrome', () => {
  for (const field of FIELDS) {
    for (const chrome of CHROME) {
      test(`${field.name} keeps focus when clicking the ${chrome.name}`, async ({ page }) => {
        await gotoDiary(page);

        if (chrome.selector.includes('punctuation')) {
          await page.locator('#punctuationToggle').click();
        }

        const target = page.locator(field.selector).first();
        await target.click();
        await expect(target).toBeFocused();

        await page.locator(chrome.selector).first().click();

        await expect(target).toBeFocused();
      });
    }
  }

  test('the transliteration toggle still flips while focus is preserved', async ({ page }) => {
    await gotoDiary(page);

    const editor = page.locator('.editor-diary .ql-editor:visible').first();
    await editor.click();
    await editor.pressSequentially('Hello');

    const toggle = page.locator('#translitToggle');
    await expect(toggle).toBeChecked();

    // preventDefault on mousedown must not swallow the label's own activation.
    await page.locator('.toggle-slider').click();

    await expect(toggle).not.toBeChecked();
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('Hello');
  });
});
