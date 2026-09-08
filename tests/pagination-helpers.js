/**
 * Shared Playwright helpers for diary/letter pagination overflow checks.
 */

/**
 * Install `window.__q(i)` — returns the live Quill for diary page `i`,
 * activating a static right column first when needed.
 * @param {import('@playwright/test').Page} page
 */
export async function installDiaryQuillHelper(page) {
  await page.evaluate(() => {
    // Quill keeps a destroyed instance registered on its container, so a static
    // right column still answers Quill.find() with an editor whose root was
    // removed from the DOM. Measuring that root reports 0 height.
    const liveQuill = (host) => {
      const quill = window.Quill ? window.Quill.find(host) : null;
      if (!quill) return null;
      if (host.dataset.staticRight === '1') return null;
      return host.contains(quill.root) ? quill : null;
    };
    const hostAt = (i) => {
      const host = document.querySelectorAll('.diary-page')[i]
        ?.querySelector('[data-col="right"]');
      return host instanceof HTMLElement ? host : null;
    };
    // Read-only: never activates a page, so it is safe inside assertions.
    window.__liveQ = (i) => {
      const host = hostAt(i);
      return host ? liveQuill(host) : null;
    };
    window.__q = (i) => {
      const host = hostAt(i);
      if (!host) return null;
      let quill = liveQuill(host);
      if (!quill) {
        host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        quill = liveQuill(host);
      }
      return quill;
    };
  });
}

const EMPTY_HEADER = {
  fir_number: '', thana: '', district: '', case_diary_no: '',
  rule_no: '', against_1: '', against_2: '', special_report_no: '',
  fir_date: '', event_date_place: '', sections: '', investigation_record: '',
};

/**
 * Leave the diary at exactly one page holding `freeLines` fewer lines than it
 * can fit, optionally with `lastLine` as its final line.
 *
 * Slack cannot be tuned by deleting text: while a page 2 exists, absorb pulls
 * the lines straight back. So overfill once, let the pager cut page 1 at
 * capacity, then reuse that cut as the whole document.
 * @param {import('@playwright/test').Page} page
 * @param {{ lastLine?: string, freeLines?: number }} [opts]
 */
export async function fillSinglePage(page, opts = {}) {
  const { lastLine = null, freeLines = 0 } = opts;
  await page.evaluate((header) => {
    // Numbered lines: any block that gets welded to its neighbour is obvious.
    let html = '';
    for (let i = 1; i <= 60; i++) html += `<p>${i}</p>`;
    window.__bpDiarySheet.setModel({
      pages: [{
        hasHeader: true, header, left: '', right: html,
      }],
    });
  }, EMPTY_HEADER);
  await page.waitForFunction(
    () => document.querySelectorAll('.diary-page').length > 1,
    null,
    { timeout: 15000 },
  );

  const capacityHtml = await page.evaluate(
    () => window.__bpDiarySheet.getModel().pages[0].right,
  );
  await page.evaluate(({
    header, html, last, free,
  }) => {
    const parts = html.split(/(?=<p\b)/i).filter(Boolean);
    const kept = parts.slice(0, Math.max(1, parts.length - free));
    if (last != null) kept[kept.length - 1] = `<p>${last}</p>`;
    window.__bpDiarySheet.setModel({
      pages: [{ hasHeader: true, header, left: '', right: kept.join('') }],
    });
  }, {
    header: EMPTY_HEADER, html: capacityHtml, last: lastLine, free: freeLines,
  });
  await page.waitForTimeout(500);
}

/**
 * Text of every right-column block across all pages, in reading order.
 * Blank lines come back as ''. Absorb/spill may move blocks between pages but
 * must never change this sequence.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function rightColumnBlocks(page) {
  return page.evaluate(() => {
    const holder = document.createElement('div');
    const out = [];
    for (const p of window.__bpDiarySheet.getModel().pages) {
      holder.innerHTML = p.right || '';
      for (const block of holder.children) out.push(block.textContent || '');
    }
    return out;
  });
}

/**
 * Plain text from a diary right column (live Quill or static HTML).
 * @param {import('@playwright/test').Page} page
 * @param {number} i
 */
export async function diaryRightText(page, i) {
  return page.evaluate((idx) => {
    const host = document.querySelectorAll('.diary-page')[idx]
      ?.querySelector('[data-col="right"]');
    if (!host) return '';
    const quill = window.Quill ? window.Quill.find(host) : null;
    if (quill) return quill.getText() || '';
    const editor = host.querySelector('.ql-editor');
    return editor?.innerText || editor?.textContent || '';
  }, i);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{ page: number, kind: string, overflowPx: number, scrollTop: number }>>}
 */
export async function clippedDiaryBoxes(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.diary-page').forEach((pageEl, i) => {
      const left = pageEl.querySelector('[data-col="left"]');
      if (left instanceof HTMLTextAreaElement) {
        const overflowPx = left.scrollHeight - left.clientHeight;
        if (overflowPx > 1 || left.scrollTop > 0) {
          out.push({
            page: i + 1,
            kind: 'left',
            overflowPx,
            scrollTop: left.scrollTop,
          });
        }
      }
      const editor = pageEl.querySelector('[data-col="right"] .ql-editor');
      if (editor instanceof HTMLElement) {
        const overflowPx = editor.scrollHeight - editor.clientHeight;
        if (overflowPx > 1 || editor.scrollTop > 0) {
          out.push({
            page: i + 1,
            kind: 'right',
            overflowPx,
            scrollTop: editor.scrollTop,
          });
        }
      }
    });
    return out;
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{ page: number, overflowPx: number, scrollTop: number }>>}
 */
export async function clippedLetterBoxes(page) {
  return page.evaluate(() => [...document.querySelectorAll('.letter-page .ql-editor')]
    .map((el, i) => ({
      page: i + 1,
      overflowPx: el.scrollHeight - el.clientHeight,
      scrollTop: el.scrollTop,
    }))
    .filter((p) => p.overflowPx > 1 || p.scrollTop > 0));
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function disableTranslit(page) {
  const toggle = page.locator('#translitToggle');
  if (await toggle.isChecked()) {
    await page.locator('.toggle-slider').click();
  }
}
