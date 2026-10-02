import { test, expect } from '@playwright/test';
import {
  openFresh, setDoc, setCaret, settle, disableTranslit, numberedLines, switchTemplate,
} from './pagination-helpers.js';

const HINDI_SAMPLE =
  'घीसू की स्त्री का तो बहुत दिन हुए, देहांत हो गया था, '
  + 'मगर माधव की स्त्री जीवित थी। यही औरत आज प्रसव-पीड़ा से कराह रही थी। '
  + 'दोनों बाप-बेटे बैठे हुए कफन की चिन्ता कर रहे थे कि कफन कहाँ से आए। '
  + 'दोनों एक ही स्वभाव के थे — आलस्य और कामचोरी।';

/**
 * Character indices where a new visual line starts in an element.
 * @param {import('@playwright/test').Locator} locator
 */
async function lineBreakOffsets(locator) {
  return locator.evaluate((el) => {
    const root = el;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    /** @type {number[]} */
    const breaks = [0];
    let lastTop = null;
    let offset = 0;
    /** @type {Text | null} */
    let node = /** @type {Text | null} */ (walker.nextNode());
    while (node) {
      const text = node.nodeValue || '';
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        if (rects.length) {
          const top = Math.round(rects[0].top);
          if (lastTop === null) lastTop = top;
          else if (Math.abs(top - lastTop) > 2) {
            breaks.push(offset + i);
            lastTop = top;
          }
        }
      }
      offset += text.length;
      node = /** @type {Text | null} */ (walker.nextNode());
    }
    return breaks;
  });
}

/**
 * Mount a print clone in an offscreen iframe with the same stylesheets.
 * @param {import('@playwright/test').Page} page
 * @param {'diary'|'letter'} template
 */
async function mountPrintDocumentInIframe(page, template) {
  return page.evaluate(async (tpl) => {
    const mod = await import('/js/export/print-document.js');
    const built = mod.buildPrintDocumentHtml(tpl);
    if (!built) throw new Error('buildPrintDocumentHtml returned null');

    let iframe = document.getElementById('print-parity-iframe');
    if (iframe) iframe.remove();
    iframe = document.createElement('iframe');
    iframe.id = 'print-parity-iframe';
    iframe.setAttribute('scrolling', 'no');
    iframe.style.cssText = 'position:absolute;left:-20000px;top:0;width:210mm;height:4000px;border:0;overflow:hidden;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) throw new Error('no iframe document');
    doc.open();
    doc.write(`<!DOCTYPE html><html><head>
      ${mod.printDocumentStylesheetLinks()}
      <style>${mod.printDocumentExtraCss()}</style>
    </head><body class="print-root">${built.html}</body></html>`);
    doc.close();

    // Wait for linked stylesheets
    const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
    await Promise.all(links.map((link) => new Promise((resolve) => {
      if (link.sheet) {
        resolve();
        return;
      }
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    })));

    if (doc.fonts?.load) {
      const size = 16;
      await doc.fonts.load(`${size}px "Noto Sans Devanagari"`);
      await doc.fonts.ready;
    }
    // Force layout
    void doc.body.offsetHeight;
    return { pageCount: built.pageCount };
  }, template);
}

test.describe('Print parity (live clone)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  const liveCell = (page, col, tpl = 'diary') => page.locator(`.editor-${tpl} .bp-cell[data-col="${col}"]`).first();
  const printCell = (page, col, pageSel = '.diary-page') => page.frameLocator('#print-parity-iframe')
    .locator(`${pageSel} .bp-cell[data-col="${col}"]`).first();

  async function fontsReady(page) {
    await page.evaluate(async () => {
      if (document.fonts?.load) {
        await document.fonts.load('16px "Noto Sans Devanagari"');
        await document.fonts.ready;
      }
    });
  }

  test('saved text keeps ordinary spaces (no non-breaking spaces)', async ({ page }) => {
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText('यह  एक परीक्षण  वाक्य');
    await settle(page);
    const content = await page.evaluate(() => window.__bpTest.content());
    expect(content).not.toMatch(/\u00a0/);
    expect(content).toContain('यह  एक परीक्षण  वाक्य');
  });

  for (const col of ['right', 'left']) {
    test(`diary ${col} column wrap offsets match print clone`, async ({ page }) => {
      await setCaret(page, { page: 0, col });
      await page.keyboard.insertText(HINDI_SAMPLE);
      if (col === 'right') {
        await page.locator('#formatToolbar [data-cmd="align:justify"]').click();
      }
      await settle(page);
      await fontsReady(page);
      const screenBreaks = await lineBreakOffsets(liveCell(page, col));

      const mounted = await mountPrintDocumentInIframe(page, 'diary');
      expect(mounted.pageCount).toBeGreaterThanOrEqual(1);
      await expect(printCell(page, col)).toBeVisible({ timeout: 10000 });

      const widths = await page.evaluate((c) => {
        const live = document.querySelector(`.editor-diary .bp-cell[data-col="${c}"]`);
        const frame = /** @type {HTMLIFrameElement|null} */ (document.getElementById('print-parity-iframe'));
        const print = frame?.contentDocument?.querySelector(`.bp-cell[data-col="${c}"]`);
        return { live: live?.clientWidth ?? 0, print: print?.clientWidth ?? 0 };
      }, col);
      expect(Math.abs(widths.print - widths.live)).toBeLessThanOrEqual(1);
      expect(await lineBreakOffsets(printCell(page, col))).toEqual(screenBreaks);
    });
  }

  test('print clone has no editor chrome', async ({ page }) => {
    await mountPrintDocumentInIframe(page, 'diary');
    const frame = page.frameLocator('#print-parity-iframe');
    await expect(frame.locator('.diary-page-chrome')).toHaveCount(0);
    await expect(frame.locator('#formatToolbar')).toHaveCount(0);
    await expect(frame.locator('.header-frame')).toHaveCount(0);
    await expect(frame.locator('.screen-only')).toHaveCount(0);
    await expect(frame.locator('[data-placeholder]')).toHaveCount(0);
    await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test('multi-page spill clones all diary pages and nothing overflows on paper', async ({ page }) => {
    await setDoc(page, [{ right: Array.from({ length: 40 }, () => HINDI_SAMPLE), left: numberedLines(1, 70) }]);
    const liveCount = await page.locator('.editor-diary .diary-page').count();
    expect(liveCount).toBeGreaterThanOrEqual(2);

    const mounted = await mountPrintDocumentInIframe(page, 'diary');
    expect(mounted.pageCount).toBe(liveCount);

    const overflow = await page.frameLocator('#print-parity-iframe')
      .locator('.bp-cell')
      .evaluateAll((cells) => cells.map((cell) => {
        const last = cell.lastElementChild;
        const pad = parseFloat(getComputedStyle(cell).paddingBottom) || 0;
        const limit = cell.getBoundingClientRect().top + cell.clientHeight - pad;
        return last ? last.getBoundingClientRect().bottom - limit : 0;
      }));
    for (const px of overflow) expect(px).toBeLessThanOrEqual(0.5);
  });

  test('diary right column keeps paragraph breaks and text-align in print clone', async ({ page }) => {
    const lines = [
      { text: 'चार', align: null },
      { text: 'सेंटर', align: 'center' },
      { text: 'राइट', align: 'right' },
      { text: 'जस्टिफाई', align: 'justify' },
    ];
    await setCaret(page, { page: 0, col: 'right' });
    for (let i = 0; i < lines.length; i++) {
      const { text, align } = lines[i];
      if (i > 0) await page.keyboard.press('Enter');
      await page.keyboard.insertText(text);
      if (align === 'right') {
        // No toolbar button for right alignment; set it through the editor.
        await page.evaluate(() => window.__bpDiarySheet.editor.commands.setTextAlign('right'));
      } else if (align) {
        await page.locator(`#formatToolbar [data-cmd="align:${align}"]`).click();
      }
    }
    await settle(page);

    const norm = (a) => (a === 'start' ? 'left' : a);
    const read = (paras) => paras.map((p) => ({ text: (p.textContent || '').trim(), align: getComputedStyle(p).textAlign }));
    const liveAligns = await liveCell(page, 'right').locator('p').evaluateAll(read);
    expect(liveAligns.map((p) => p.text)).toEqual(['चार', 'सेंटर', 'राइट', 'जस्टिफाई']);
    expect(liveAligns.map((p) => norm(p.align))).toEqual(['left', 'center', 'right', 'justify']);

    await mountPrintDocumentInIframe(page, 'diary');
    const printParas = page.frameLocator('#print-parity-iframe').locator('.diary-page .bp-cell[data-col="right"] p');
    await expect(printParas).toHaveCount(4);
    const printAligns = await printParas.evaluateAll(read);
    expect(printAligns.map((p) => p.text)).toEqual(liveAligns.map((p) => p.text));
    expect(printAligns.map((p) => norm(p.align))).toEqual(liveAligns.map((p) => norm(p.align)));
  });

  test('letter mode wrap offsets match print clone', async ({ page }) => {
    await switchTemplate(page, 'letter');
    await setCaret(page, { page: 0, col: 'main' }, 'letter');
    await page.keyboard.insertText(HINDI_SAMPLE);
    await settle(page, 'letter');
    await fontsReady(page);
    const screenBreaks = await lineBreakOffsets(liveCell(page, 'main', 'letter'));
    await mountPrintDocumentInIframe(page, 'letter');
    const printed = printCell(page, 'main', '.letter-page');
    await expect(printed).toBeVisible({ timeout: 10000 });
    expect(await lineBreakOffsets(printed)).toEqual(screenBreaks);
  });

  test('PDF export opens print dialog with cloned pages (print stubbed)', async ({ page }) => {
    await page.evaluate(() => {
      window.__bpExportMode = 'native-print';
      window.__printOpened = false;
      // Stub print() the moment the export iframe is inserted. Polling for it
      // races engines that print sooner after mounting (WebKit).
      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.id !== 'bp-print-iframe') continue;
            const w = node.contentWindow;
            w.print = () => {
              window.__printOpened = true;
              window.__printDocTitle = w.document.title;
              window.__printHasDiary = !!w.document.querySelector('.diary-page');
            };
          }
        }
      }).observe(document.body, { childList: true });
    });

    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText('परीक्षण निर्यात');

    await page.locator('#exportBtn').click();
    await page.waitForFunction(() => window.__printOpened === true, null, { timeout: 15000 });
    const meta = await page.evaluate(() => ({
      title: window.__printDocTitle,
      hasDiary: window.__printHasDiary,
    }));
    expect(meta.title).toBe('Print Document');
    expect(meta.hasDiary).toBe(true);
  });


  test('blank lines on the last diary page print as blank lines', async ({ page }) => {
    const sentence = 'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6);
    const blankCount = 4;
    await setDoc(page, [{ right: [...Array.from({ length: 12 }, () => sentence), 'आखिरी', ...Array(blankCount).fill('')] }]);
    expect(await page.locator('.editor-diary .diary-page').count()).toBeGreaterThanOrEqual(2);

    const measure = (cell) => {
      const paras = [...cell.querySelectorAll('p')];
      return {
        emptyCount: paras.filter((p) => !(p.textContent || '').trim()).length,
        brCount: cell.querySelectorAll('p > br').length,
        contentHeight: paras.length ? paras[paras.length - 1].getBoundingClientRect().bottom - paras[0].getBoundingClientRect().top : 0,
      };
    };
    const screen = await page.locator('.editor-diary .diary-page').last()
      .locator('.bp-cell[data-col="right"]').evaluate(measure);
    expect(screen.emptyCount).toBe(blankCount);

    await mountPrintDocumentInIframe(page, 'diary');
    const printed = await page.frameLocator('#print-parity-iframe').locator('.diary-page').last()
      .locator('.bp-cell[data-col="right"]').evaluate(measure);
    expect(printed.emptyCount).toBe(blankCount);
    expect(printed.brCount).toBeGreaterThanOrEqual(blankCount);
    // WYSIWYG: print must not collapse blank-line height.
    expect(Math.abs(printed.contentHeight - screen.contentHeight)).toBeLessThanOrEqual(1);
  });

  test('forced raster-pdf path builds A4 blob without calling print', async ({ page }) => {
    test.setTimeout(90_000);

    page.on('dialog', async (dialog) => {
      await page.evaluate((msg) => {
        window.__rasterPdfMeta = { error: `dialog:${msg}` };
        window.__rasterPdfDone = true;
      }, dialog.message());
      await dialog.dismiss();
    });

    await page.evaluate(() => {
      window.__bpExportMode = 'raster-pdf';
      window.__printOpened = false;
      window.__rasterPdfDone = false;
      window.__rasterPdfMeta = null;
      window.__rasterPdfErrors = [];
      window.__tabsOpened = 0;

      const origError = console.error.bind(console);
      console.error = (...args) => {
        window.__rasterPdfErrors.push(args.map(String).join(' '));
        origError(...args);
      };

      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.id === 'bp-print-iframe') node.contentWindow.print = () => { window.__printOpened = true; };
          }
        }
      }).observe(document.body, { childList: true });

      // A blank tab opened before generation is exactly the iOS failure mode.
      window.open = () => { window.__tabsOpened += 1; return null; };

      // Intercept the download anchor to inspect the produced blob.
      const origCreate = document.createElement.bind(document);
      document.createElement = (tag, ...rest) => {
        const el = origCreate(tag, ...rest);
        if (String(tag).toLowerCase() === 'a') {
          el.click = () => {
            const href = el.getAttribute('href') || '';
            window.__rasterPdfDownloadName = el.download;
            if (href.startsWith('blob:')) {
              fetch(href).then(async (r) => {
                const bytes = new Uint8Array(await r.arrayBuffer());
                const text = new TextDecoder('latin1').decode(bytes);
                window.__rasterPdfMeta = {
                  header: String.fromCharCode(...bytes.slice(0, 5)),
                  byteLength: bytes.byteLength,
                  pageCount: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
                };
                window.__rasterPdfDone = true;
              }).catch((err) => {
                window.__rasterPdfMeta = { error: String(err) };
                window.__rasterPdfDone = true;
              });
            } else {
              window.__rasterPdfMeta = { error: `unexpected href: ${href}` };
              window.__rasterPdfDone = true;
            }
          };
        }
        return el;
      };
    });

    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText('मोबाइल पीडीएफ परीक्षण');
    await settle(page);

    const liveMeta = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.editor-diary .diary-page')];
      return {
        pageCount: pages.length,
        width: pages[0]?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(liveMeta.pageCount).toBeGreaterThanOrEqual(1);
    expect(liveMeta.width).toBeGreaterThan(700);

    await page.locator('#exportBtn').click();
    await page.waitForFunction(() => window.__rasterPdfDone === true, null, { timeout: 60000 });

    const result = await page.evaluate(() => ({
      printOpened: window.__printOpened,
      meta: window.__rasterPdfMeta,
      errors: window.__rasterPdfErrors,
      tabsOpened: window.__tabsOpened,
      downloadName: window.__rasterPdfDownloadName,
    }));

    expect(result.meta?.error, JSON.stringify(result)).toBeUndefined();
    expect(result.printOpened).toBe(false);
    expect(result.tabsOpened).toBe(0);
    expect(result.downloadName).toMatch(/\.pdf$/);
    expect(result.meta?.header).toBe('%PDF-');
    expect(result.meta?.byteLength).toBeGreaterThan(1000);
    expect(result.meta?.pageCount).toBe(liveMeta.pageCount);
  });
});
