import { test, expect } from '@playwright/test';

/**
 * The diary header mixes field types: most rows are <input>, but धारा and
 * घटना की तिथि और स्थान are contenteditable spans (they reflow the header).
 * Dictation used to only recognise Quill roots and input/textarea, so focusing
 * a span fell through to the *previously* focused field and the transcript
 * landed in the wrong row. These tests pin every target type.
 */

const FLOW_FIELDS = ['sections', 'event_date_place'];

/** Drive the same hook the dictation engine's onFinal callback calls. */
async function dictate(page, text) {
  await page.evaluate((t) => window.__bpDictation.insertText(t), text);
}

async function gotoDiary(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__uxInitComplete && window.__bpDictation);
  await expect(page.locator('.diary-page').first()).toBeVisible();
}

test.describe('Dictation insertion target', () => {
  for (const field of FLOW_FIELDS) {
    test(`text lands in the contenteditable header field "${field}"`, async ({ page }) => {
      await gotoDiary(page);

      // Focus an <input> first — this is the stale target that used to win.
      const fir = page.locator('[data-field="fir_number"]').first();
      await fir.click();
      await fir.fill('123/26');

      const flow = page.locator(`[data-field="${field}"]`).first();
      await flow.click();
      await dictate(page, 'धारा 302 भादवि');

      await expect(flow).toHaveText('धारा 302 भादवि');
      await expect(fir).toHaveValue('123/26');
    });
  }

  test('target survives focus leaving the field', async ({ page }) => {
    await gotoDiary(page);

    const fir = page.locator('[data-field="fir_number"]').first();
    await fir.click();
    await fir.fill('9/26');

    const flow = page.locator('[data-field="sections"]').first();
    await flow.click();
    await page.evaluate(() => document.activeElement.blur());

    await dictate(page, 'धारा 420');

    // Without focusin tracking for contenteditable this fell back to the input.
    await expect(flow).toHaveText('धारा 420');
    await expect(fir).toHaveValue('9/26');
  });

  test('inserts at the caret and replaces a selection', async ({ page }) => {
    await gotoDiary(page);

    const flow = page.locator('[data-field="sections"]').first();
    await flow.click();
    await dictate(page, 'धारा 302');

    // Select the leading "धारा " and dictate over it.
    await page.evaluate(() => {
      const el = document.querySelector('[data-field="sections"]');
      el.focus();
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.setEnd(el.firstChild, 5);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await dictate(page, 'अंतर्गत ');

    await expect(flow).toHaveText('अंतर्गत 302');
  });

  test('dictated header text reaches the saved model', async ({ page }) => {
    await gotoDiary(page);

    await page.locator('[data-field="sections"]').first().click();
    await dictate(page, 'धारा 302');

    const saved = await page.evaluate(
      () => window.__bpDiarySheet.getModel().pages[0].header.sections,
    );
    expect(saved).toBe('धारा 302');
  });

  test('input and Quill targets still work', async ({ page }) => {
    await gotoDiary(page);

    const thana = page.locator('[data-field="thana"]').first();
    await thana.click();
    await dictate(page, 'कोतवाली');
    await expect(thana).toHaveValue('कोतवाली');

    const quill = page.locator('.editor-diary .ql-editor:visible').first();
    await quill.click();
    await dictate(page, 'अन्वेषण शुरू किया');
    await expect(quill).toContainText('अन्वेषण शुरू किया');
  });

  test('clicking the punctuation panel keeps focus in a contenteditable field', async ({ page }) => {
    await gotoDiary(page);

    const flow = page.locator('[data-field="sections"]').first();
    await flow.click();
    await expect(flow).toBeFocused();

    await page.locator('#punctuationToggle').click();
    await page.locator('.punctuation-grid div.punctuation-tile').first().click();

    // Focus retention only covered ql-editor/input/textarea before.
    await expect(flow).toBeFocused();
  });
});
