import { test, expect } from '@playwright/test';
import {
  openFresh, setDoc, setCaret, settle, columnPages, pageCount, clippedBoxes, caret,
  disableTranslit, switchTemplate,
} from './pagination-helpers.js';

/**
 * Tables and images in the paged editors.
 *
 * Tables are cut between rows across pages (never inside a row) and each
 * continuation repeats the header row on screen and paper — never in the
 * document. Images are one block, sized as a share of the column, scaled
 * down on insert.
 */

const toolbar = (page) => page.locator('#formatToolbar');
const cmd = (page, name) => toolbar(page).locator(`[data-cmd="${name}"]`);
/** A table menu item; opens the caret cell's menu (Shift+F10) first. */
async function tableItem(page, name) {
  await page.keyboard.press('Shift+F10');
  const item = page.locator(`.table-controls [data-table-cmd="${name}"]`);
  await expect(item).toBeVisible();
  return item;
}

/** A table spec: header + `n` body rows. */
function tableSpec(n, cols = 3) {
  const header = Array.from({ length: cols }, (_, c) => `H${c + 1}`);
  const body = Array.from({ length: n }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`));
  return { table: [header, ...body], header: true };
}

/** Every body row of a column's table pieces, in reading order. */
async function tableRows(page, col, template) {
  const pages = await columnPages(page, col, template);
  return pages.flat()
    .filter((b) => b.replace(/^\+/, '').startsWith('table:'))
    .flatMap((b) => b.replace(/^\+?table:/, '').split('/'));
}

/** A large photo-like PNG made in the page; returns its bytes. */
async function makePng(page, width, height) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2b6cb0');
    grad.addColorStop(1, '#f6ad55');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  return Buffer.from(b64, 'base64');
}

/** Image nodes of the active editor: attrs plus rendered width share. */
async function images(page, template) {
  return page.evaluate((t) => {
    const ed = t === 'letter' ? window.__bpLetterSheet?.editor : window.__bpDiarySheet?.editor;
    const out = [];
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name !== 'image') return true;
      const dom = ed.view.nodeDOM(pos);
      const img = dom.querySelector('img');
      out.push({
        pos,
        width: n.attrs.width,
        alt: n.attrs.alt,
        type: n.attrs.src.slice(5, n.attrs.src.indexOf(';')),
        natural: [img.naturalWidth, img.naturalHeight],
        share: Math.round((dom.getBoundingClientRect().width / dom.parentElement.getBoundingClientRect().width) * 100),
      });
      return false;
    });
    return out;
  }, template);
}

test.describe('Tables', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  test.afterEach(async ({ page }) => {
    const stats = await page.evaluate(() => window.__bpTest.stats());
    expect(stats.capHits).toBe(0);
  });

  test('the toolbar inserts a 3×3 table with a header row; the table controls show only inside it', async ({ page }) => {
    await setDoc(page, [{ right: ['intro'] }]);
    await setCaret(page, { col: 'right' });
    const controls = page.locator('.table-controls');
    await expect(controls).toBeHidden();

    await cmd(page, 'table').click();
    await page.keyboard.type('Item');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Qty');
    await settle(page);

    expect((await columnPages(page, 'right'))[0]).toEqual(['intro', 'table:#Item,Qty,/,,/,,', '']);
    await expect(controls).toBeVisible();
    await expect(cmd(page, 'table')).toBeDisabled(); // no nested tables
    await expect(await tableItem(page, 'header')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await (await tableItem(page, 'colAfter')).click();
    await (await tableItem(page, 'rowAfter')).click();
    await settle(page);
    expect((await columnPages(page, 'right'))[0][1]).toBe('table:#Item,Qty,,/,,,/,,,/,,,');

    // Leaving the table hides its controls again.
    await setCaret(page, { col: 'right', block: 0 });
    await expect(controls).toBeHidden();
  });

  test('a long table is cut between rows, repeats its header, and never clips', async ({ page }) => {
    const spec = tableSpec(70);
    await setDoc(page, [{ right: ['intro', spec, 'after'] }]);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);

    // Every row once, in order: the cut never loses, splits or duplicates a row.
    const rows = await tableRows(page, 'right');
    expect(rows).toEqual(spec.table.map((r, i) => (i === 0 ? '#' : '') + r.join(',')));

    const pages = await columnPages(page, 'right');
    expect(pages[0][1].startsWith('table:#H1,H2,H3/')).toBe(true);
    expect(pages[1][0].startsWith('+table:')).toBe(true);
    expect(pages[1][0]).not.toContain('#'); // the header is not copied into the document

    // ...but every continuation shows it.
    const repeats = page.locator('.bp-table-repeat');
    await expect(repeats).toHaveCount((await pageCount(page)) - 1);
    await expect(repeats.first()).toHaveText('H1H2H3');
  });

  test('typing Tab through the last cell grows the table onto the next page', async ({ page }) => {
    await setDoc(page, [{ right: ['intro', tableSpec(1, 2)] }]);
    // Last cell of the table.
    await page.evaluate(() => {
      const ed = window.__bpDiarySheet.editor;
      let end = -1;
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'table') end = pos + n.nodeSize - 3;
        return end < 0;
      });
      ed.view.focus();
      ed.commands.setTextSelection(end);
    });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      await page.keyboard.type(`n${i}`);
      await page.keyboard.press('Tab');
    }
    await settle(page);
    expect(await pageCount(page)).toBe(2);
    expect(await clippedBoxes(page)).toEqual([]);
    const c = await caret(page);
    expect(c.page).toBe(1);
    expect(c.text).toBe('');
    // The caret's cell is the last one; the last typed text is right before it.
    const rows = await tableRows(page, 'right');
    expect(rows[rows.length - 1]).toBe('n39,');
  });

  test('a header row is never left alone at the bottom of a page', async ({ page }) => {
    // Fill the column so only about one line is left, then add a table.
    await setDoc(page, [{ right: Array.from({ length: 80 }, (_, i) => String(i + 1)) }]);
    const capacity = (await columnPages(page, 'right'))[0].length;
    await setDoc(page, [{ right: [...Array.from({ length: capacity - 1 }, (_, i) => String(i + 1)), tableSpec(3)] }]);
    const pages = await columnPages(page, 'right');
    // The whole table moved: page 1 does not end in a lone header row.
    expect(pages[0].some((b) => b.includes('table:'))).toBe(false);
    expect(pages[1][0].startsWith('table:#H1')).toBe(true);
  });

  test('delete table removes every piece; undo brings them back', async ({ page }) => {
    await setDoc(page, [{ right: ['intro', tableSpec(70), 'after'] }]);
    const before = await columnPages(page, 'right');
    // Caret into the continuation on page 2.
    await page.evaluate(() => {
      const ed = window.__bpDiarySheet.editor;
      const page2 = ed.state.doc.child(0).nodeSize;
      ed.view.focus();
      ed.commands.setTextSelection(page2 + 10);
    });
    await (await tableItem(page, 'deleteTable')).click();
    await settle(page);
    expect(await columnPages(page, 'right')).toEqual([['intro', 'after']]);
    expect((await caret(page)).page).toBe(0);

    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await columnPages(page, 'right')).toEqual(before);
  });

  test('adding a column from the second page adds it to the whole table', async ({ page }) => {
    await setDoc(page, [{ right: ['intro', tableSpec(70, 2)] }]);
    await page.evaluate(() => {
      const ed = window.__bpDiarySheet.editor;
      ed.view.focus();
      ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 10);
    });
    await (await tableItem(page, 'colAfter')).click();
    await settle(page);
    const rows = await tableRows(page, 'right');
    expect(rows.every((r) => r.split(',').length === 3)).toBe(true);
    await expect(page.locator('.bp-table-repeat').first()).toHaveText('H1H2');
  });
});

test.describe('Images', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
    await switchTemplate(page, 'letter');
  });

  test('insert from the toolbar scales a large photo down and places it at the caret', async ({ page }) => {
    await setDoc(page, [['before', 'after']], 'letter');
    await setCaret(page, { block: 0 }, 'letter');
    const png = await makePng(page, 3200, 2400);

    const chooser = page.waitForEvent('filechooser');
    await cmd(page, 'image').click();
    await (await chooser).setFiles({ name: 'site_photo.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.bp-image img')).toHaveCount(1);
    await settle(page, 'letter');

    expect(await columnPages(page, 'main', 'letter')).toEqual([['before', 'img', 'after']]);
    const [img] = await images(page, 'letter');
    expect(img.type).toBe('image/jpeg'); // no transparency → JPEG
    expect(img.natural).toEqual([1600, 1200]);
    expect(img.alt).toBe('site photo');
    expect(img.width).toBeNull();
    expect(img.share).toBeGreaterThanOrEqual(99); // natural size is wider than the column
    expect(await clippedBoxes(page, 'letter')).toEqual([]);
  });

  test('dragging the corner handle resizes; Alt+arrows step by 10%', async ({ page }) => {
    const png = await makePng(page, 800, 400);
    await setDoc(page, [[{ img: `data:image/png;base64,${png.toString('base64')}`, width: 80 }, 'after']], 'letter');
    const box = page.locator('.bp-image');
    await box.click();
    const handle = box.locator('.bp-image-handle');
    await expect(handle).toBeVisible();

    const hb = await handle.boundingBox();
    const colWidth = await page.evaluate(() => {
      const host = document.querySelector('.bp-image').parentElement;
      const cs = getComputedStyle(host);
      const s = host.getBoundingClientRect().width / host.offsetWidth;
      return (host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * s;
    });
    // The image is centred: moving the corner by d changes the width by 2d.
    const d = colWidth * 0.15;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - d, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    await settle(page, 'letter');
    let [img] = await images(page, 'letter');
    expect(img.width).toBeGreaterThanOrEqual(48);
    expect(img.width).toBeLessThanOrEqual(52);

    await page.keyboard.press('Alt+ArrowLeft');
    [img] = await images(page, 'letter');
    expect(img.width).toBe(40);
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowRight');
    [img] = await images(page, 'letter');
    expect(img.width).toBe(60);

    // Undo steps back one resize at a time.
    await page.keyboard.press('ControlOrMeta+z');
    [img] = await images(page, 'letter');
    expect(img.width).toBe(50);
  });

  test('a tall image never exceeds one writing box', async ({ page }) => {
    const png = await makePng(page, 300, 1600);
    await setDoc(page, [['top', { img: `data:image/png;base64,${png.toString('base64')}`, width: 100 }, 'after']], 'letter');
    await settle(page, 'letter');
    expect(await clippedBoxes(page, 'letter')).toEqual([]);
    const pages = await columnPages(page, 'main', 'letter');
    expect(pages.flat()).toEqual(['top', 'img', 'after']);
    const fits = await page.evaluate(() => {
      const img = document.querySelector('.bp-image img').getBoundingClientRect();
      const cell = document.querySelector('.bp-image').closest('.bp-cell').getBoundingClientRect();
      return img.height <= cell.height + 0.5;
    });
    expect(fits).toBe(true);
  });

  test('dropping an image file inserts it where it was dropped', async ({ page }) => {
    await setDoc(page, [['first line', 'second line']], 'letter');
    const png = await makePng(page, 400, 300);
    const target = page.locator('.bp-cell p').nth(1);
    const tb = await target.boundingBox();
    await page.evaluate(async ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { b64: png.toString('base64'), x: tb.x + 2, y: tb.y + tb.height / 2 });
    await expect(page.locator('.bp-image img')).toHaveCount(1);
    await settle(page, 'letter');
    expect(await columnPages(page, 'main', 'letter')).toEqual([['first line', 'img', 'second line']]);
  });

  test('print clone keeps images and repeated headers but no editing chrome', async ({ page }) => {
    const png = await makePng(page, 400, 300);
    await setDoc(page, [[{ img: `data:image/png;base64,${png.toString('base64')}`, width: 50 }, tableSpec(60)]], 'letter');
    await page.locator('.bp-image').click(); // selected: handle + outline on screen
    const doc = await page.evaluate(async () => {
      const mod = await import('/js/export/print-document.js');
      const { html } = mod.buildPrintDocumentHtml('letter');
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return {
        images: parsed.querySelectorAll('.bp-image img').length,
        repeats: parsed.querySelectorAll('.bp-table-repeat').length,
        width: parsed.querySelector('.bp-image')?.style.width,
        css: mod.printDocumentExtraCss(),
      };
    });
    expect(doc.images).toBe(1);
    expect(doc.width).toBe('50%');
    expect(doc.repeats).toBeGreaterThan(0);
    expect(doc.css).toContain('.print-pages .screen-only');
    expect(doc.css).toContain('.print-pages .ProseMirror-selectednode');
  });
});
