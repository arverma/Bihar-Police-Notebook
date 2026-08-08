import { test, expect } from '@playwright/test';

const HINDI_SAMPLE =
  'घीसू की स्त्री का तो बहुत दिन हुए, देहांत हो गया था, '
  + 'मगर माधव की स्त्री जीवित थी। यही औरत आज प्रसव-पीड़ा से कराह रही थी। '
  + 'दोनों बाप-बेटे बैठे हुए कफन की चिन्ता कर रहे थे कि कफन कहाँ से आए। '
  + 'दोनों एक ही स्वभाव के थे — आलस्य और कामचोरी।';

/**
 * Character indices where a new visual line starts in an element (Quill / div).
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
async function mountPrintCloneInIframe(page, template) {
  return page.evaluate(async (tpl) => {
    const mod = await import('/js/print-clone.js');
    const built = mod.buildPrintCloneBody(tpl);
    if (!built) throw new Error('buildPrintCloneBody returned null');

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
      ${mod.printCloneStylesheetLinks()}
      <style>${mod.printCloneExtraCss()}</style>
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
    return {
      pageCount: built.pageCount,
      sampleWidth: doc.querySelector('.print-static-quill')?.getAttribute('style') || '',
      clientWidth: doc.querySelector('.print-static-quill')?.clientWidth ?? -1,
    };
  }, template);
}

test.describe('Print parity (live clone)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.editor-diary .diary-page');
    // Disable transliteration via DOM (checkbox may be visually hidden)
    await page.evaluate(() => {
      const toggle = document.getElementById('translitToggle');
      if (toggle instanceof HTMLInputElement && toggle.checked) {
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  test('sanitize/getQuillHtml path stores no nbsp in diary right HTML', async ({ page }) => {
    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el, text) => {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }, 'यह एक परीक्षण वाक्य है जिसमें कई शब्द हैं');

    // Blur so model syncs via Quill text-change
    await page.locator('.diary-page-label').first().click({ force: true }).catch(() => {});

    const html = await page.evaluate(async () => {
      const mod = await import('/js/quill-fields.js');
      const root = document.querySelector('.editor-diary .ql-editor');
      // Prefer live sanitize of semantic-like nbsp HTML
      const poisoned = '<p>यह&nbsp;एक&nbsp;परीक्षण</p>';
      return mod.sanitizeQuillHtml(poisoned);
    });
    expect(html).not.toMatch(/\u00a0/);
    expect(html).not.toMatch(/&nbsp;/i);
    expect(html).toContain('यह एक परीक्षण');
  });

  test('diary right column wrap offsets match print clone', async ({ page }) => {
    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el, text) => {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }, HINDI_SAMPLE);

    // Apply justify if toolbar present
    const justify = page.locator('#quillToolbar [data-ql="align:justify"]');
    if (await justify.count()) {
      await editor.click();
      await justify.click();
    }

    await page.waitForTimeout(200);
    // Ensure editor fonts are ready before measuring wraps
    await page.evaluate(async () => {
      if (document.fonts?.load) {
        await document.fonts.load('16px "Noto Sans Devanagari"');
        await document.fonts.ready;
      }
    });
    const screenBreaks = await lineBreakOffsets(editor);

    const mounted = await mountPrintCloneInIframe(page, 'diary');
    expect(mounted.pageCount).toBeGreaterThanOrEqual(1);
    expect(mounted.sampleWidth).toMatch(/width:\s*\d+px/);

    const printEditor = page.frameLocator('#print-parity-iframe')
      .locator('.diary-page .print-static-quill').first();
    await expect(printEditor).toBeVisible({ timeout: 10000 });

    const widths = await page.evaluate(() => {
      const live = document.querySelector('.editor-diary .diary-page .ql-editor');
      const frame = /** @type {HTMLIFrameElement|null} */ (document.getElementById('print-parity-iframe'));
      const print = frame?.contentDocument?.querySelector('.print-static-quill');
      return {
        live: live ? live.clientWidth : 0,
        print: print ? print.clientWidth : 0,
        printStyle: print?.getAttribute('style') || '',
      };
    });
    expect(Math.abs(widths.print - widths.live)).toBeLessThanOrEqual(1);

    const printBreaks = await lineBreakOffsets(printEditor);

    expect(printBreaks).toEqual(screenBreaks);
  });

  test('diary left column text and height match print clone textarea', async ({ page }) => {
    const left = page.locator('.editor-diary textarea[data-col="left"]').first();
    const sample = 'एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह ';
    await left.fill(sample.repeat(8));

    const screenMeta = await left.evaluate((el) => ({
      value: el.value,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
    }));

    await mountPrintCloneInIframe(page, 'diary');
    const printMeta = await page.frameLocator('#print-parity-iframe')
      .locator('textarea[data-col="left"]').first()
      .evaluate((el) => ({
        value: el.value,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        readOnly: el.readOnly,
      }));

    expect(printMeta.value).toBe(screenMeta.value);
    expect(printMeta.readOnly).toBe(true);
    expect(Math.abs(printMeta.clientWidth - screenMeta.clientWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(printMeta.scrollHeight - screenMeta.scrollHeight)).toBeLessThanOrEqual(2);
  });

  test('print clone has no editor chrome', async ({ page }) => {
    await mountPrintCloneInIframe(page, 'diary');
    const frame = page.frameLocator('#print-parity-iframe');
    await expect(frame.locator('.diary-page-chrome')).toHaveCount(0);
    await expect(frame.locator('#quillToolbar')).toHaveCount(0);
    await expect(frame.locator('.header-frame')).toHaveCount(0);
    await expect(frame.locator('.screen-only')).toHaveCount(0);
  });

  test('multi-page spill clones all diary pages without overflow', async ({ page }) => {
    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    const long = (HINDI_SAMPLE + ' ').repeat(40);
    await editor.evaluate((el, text) => {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }, long);

    // Wait for spill to add pages
    await page.waitForFunction(() => {
      return document.querySelectorAll('.editor-diary .diary-page').length >= 2;
    }, null, { timeout: 15000 });

    const liveCount = await page.locator('.editor-diary .diary-page').count();
    expect(liveCount).toBeGreaterThanOrEqual(2);

    const mounted = await mountPrintCloneInIframe(page, 'diary');
    expect(mounted.pageCount).toBe(liveCount);

    const overflow = await page.frameLocator('#print-parity-iframe')
      .locator('.diary-page')
      .evaluateAll((pages) => pages.map((p) => {
        const cell = p.querySelector('.diary-cell .print-static-quill, .diary-cell .bp-ql-editor, .diary-cell textarea');
        if (!cell) return { ok: true };
        return {
          ok: cell.scrollHeight <= cell.clientHeight + 1,
          scrollHeight: cell.scrollHeight,
          clientHeight: cell.clientHeight,
        };
      }));
    for (const row of overflow) {
      expect(row.ok).toBe(true);
    }
  });

  test('diary right column keeps paragraph breaks and text-align in print clone', async ({ page }) => {
    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();

    const lines = [
      { text: 'चार', align: null },
      { text: 'सेंटर', align: 'center' },
      { text: 'राइट', align: 'right' },
      { text: 'जस्टिफाई', align: 'justify' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const { text, align } = lines[i];
      if (i > 0) await editor.press('Enter');
      await editor.evaluate((el, t) => {
        document.execCommand('insertText', false, t);
      }, text);
      if (align) {
        const btn = page.locator(`#quillToolbar [data-ql="align:${align}"]`);
        await expect(btn).toBeVisible();
        await btn.click();
      }
    }

    await page.waitForTimeout(200);

    const liveAligns = await editor.locator('p').evaluateAll((paras) => paras.map((p) => ({
      text: (p.textContent || '').trim(),
      align: getComputedStyle(p).textAlign,
      className: p.className,
    })));
    expect(liveAligns.length).toBe(4);
    expect(liveAligns.map((p) => p.text)).toEqual(['चार', 'सेंटर', 'राइट', 'जस्टिफाई']);

    await mountPrintCloneInIframe(page, 'diary');
    const printParas = page.frameLocator('#print-parity-iframe')
      .locator('.diary-page .print-static-quill p');
    await expect(printParas).toHaveCount(4);

    const printAligns = await printParas.evaluateAll((paras) => paras.map((p) => ({
      text: (p.textContent || '').trim(),
      align: getComputedStyle(p).textAlign,
      className: p.className,
    })));

    expect(printAligns.map((p) => p.text)).toEqual(liveAligns.map((p) => p.text));
    for (let i = 0; i < 4; i++) {
      const live = liveAligns[i].align;
      const print = printAligns[i].align;
      // Browsers may report left as "left" or "start"
      const norm = (a) => (a === 'start' ? 'left' : a);
      expect(norm(print)).toBe(norm(live));
    }
    expect(printAligns[1].className).toMatch(/ql-align-center/);
    expect(printAligns[2].className).toMatch(/ql-align-right/);
    expect(printAligns[3].className).toMatch(/ql-align-justify/);
  });

  test('letter mode wrap offsets match print clone', async ({ page }) => {
    await page.locator('.segment-btn[data-template="letter"]').click();
    // May prompt to save / switch — handle confirm dialogs
    page.once('dialog', (d) => d.accept());
    await page.waitForSelector('.editor-letter .letter-page .ql-editor', { timeout: 10000 });

    const editor = page.locator('.editor-letter .letter-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el, text) => {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }, HINDI_SAMPLE);

    await page.waitForTimeout(200);
    const screenBreaks = await lineBreakOffsets(editor);
    await mountPrintCloneInIframe(page, 'letter');
    const printEditor = page.frameLocator('#print-parity-iframe')
      .locator('.letter-page .print-static-quill, .letter-page .ql-editor').first();
    await expect(printEditor).toBeVisible({ timeout: 10000 });
    const printBreaks = await lineBreakOffsets(printEditor);
    expect(printBreaks).toEqual(screenBreaks);
  });

  test('PDF export opens print dialog with cloned pages (print stubbed)', async ({ page }) => {
    await page.evaluate(() => {
      window.__bpExportMode = 'native-print';
      window.__printOpened = false;
      // Continuously re-bind: document.open/write can reset contentWindow.print.
      const poll = setInterval(() => {
        const frame = document.getElementById('bp-print-iframe');
        if (!(frame instanceof HTMLIFrameElement)) return;
        const w = frame.contentWindow;
        if (!w) return;
        w.print = () => {
          window.__printOpened = true;
          window.__printDocTitle = w.document.title;
          window.__printHasDiary = !!w.document.querySelector('.diary-page');
        };
      }, 10);
      setTimeout(() => clearInterval(poll), 20000);
    });

    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el) => {
      document.execCommand('insertText', false, 'परीक्षण निर्यात');
    });

    await page.locator('#exportBtn').click();
    await page.waitForFunction(() => window.__printOpened === true, null, { timeout: 15000 });
    const meta = await page.evaluate(() => ({
      title: window.__printDocTitle,
      hasDiary: window.__printHasDiary,
    }));
    expect(meta.title).toBe('Print Document');
    expect(meta.hasDiary).toBe(true);
  });

  test('forced client-pdf path builds A4 blob without calling print', async ({ page }) => {
    test.setTimeout(90_000);

    page.on('dialog', async (dialog) => {
      await page.evaluate((msg) => {
        window.__clientPdfMeta = { error: `dialog:${msg}` };
        window.__clientPdfDone = true;
      }, dialog.message());
      await dialog.dismiss();
    });

    await page.evaluate(() => {
      window.__bpExportMode = 'client-pdf';
      window.__printOpened = false;
      window.__clientPdfDone = false;
      window.__clientPdfMeta = null;
      window.__clientPdfErrors = [];
      window.__tabsOpened = 0;
      const origError = console.error.bind(console);
      console.error = (...args) => {
        window.__clientPdfErrors.push(args.map(String).join(' '));
        origError(...args);
      };

      const poll = setInterval(() => {
        const frame = document.getElementById('bp-print-iframe');
        if (!(frame instanceof HTMLIFrameElement)) return;
        const w = frame.contentWindow;
        if (!w) return;
        w.print = () => { window.__printOpened = true; };
      }, 10);
      setTimeout(() => clearInterval(poll), 60000);

      // A blank tab opened before generation is exactly the iOS failure mode.
      window.open = () => { window.__tabsOpened += 1; return null; };

      // Intercept the download anchor to inspect the produced blob.
      const origCreate = document.createElement.bind(document);
      document.createElement = (tag, ...rest) => {
        const el = origCreate(tag, ...rest);
        if (String(tag).toLowerCase() === 'a') {
          el.click = () => {
            const href = el.getAttribute('href') || '';
            window.__clientPdfDownloadName = el.download;
            if (href.startsWith('blob:')) {
              fetch(href).then(async (r) => {
                const bytes = new Uint8Array(await r.arrayBuffer());
                const text = new TextDecoder('latin1').decode(bytes);
                window.__clientPdfMeta = {
                  header: String.fromCharCode(...bytes.slice(0, 5)),
                  byteLength: bytes.byteLength,
                  pageCount: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
                };
                window.__clientPdfDone = true;
              }).catch((err) => {
                window.__clientPdfMeta = { error: String(err) };
                window.__clientPdfDone = true;
              });
            } else {
              window.__clientPdfMeta = { error: `unexpected href: ${href}` };
              window.__clientPdfDone = true;
            }
          };
        }
        return el;
      };
    });

    const editor = page.locator('.editor-diary .diary-page .ql-editor').first();
    await editor.click();
    await editor.evaluate((el) => {
      document.execCommand('insertText', false, 'मोबाइल पीडीएफ परीक्षण');
    });

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
    await page.waitForFunction(() => window.__clientPdfDone === true, null, { timeout: 60000 });

    const result = await page.evaluate(() => ({
      printOpened: window.__printOpened,
      meta: window.__clientPdfMeta,
      errors: window.__clientPdfErrors,
      tabsOpened: window.__tabsOpened,
      downloadName: window.__clientPdfDownloadName,
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
