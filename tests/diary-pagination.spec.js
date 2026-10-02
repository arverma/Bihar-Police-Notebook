import { test, expect } from '@playwright/test';
import {
  openFresh, setDoc, setCaret, settle, columnBlocks, columnPages, pageCount, clippedBoxes, caret,
  disableTranslit, numberedLines, fillSinglePage, switchTemplate,
} from './pagination-helpers.js';

/**
 * Diary pagination: each column flows across fixed-height A4 boxes.
 *
 * Invariants checked throughout:
 *  - no writing box ever clips its text (`clippedBoxes` is empty);
 *  - moving the page boundary never changes the document (`columnBlocks` —
 *    the column's paragraphs in reading order — is unchanged by spill/absorb);
 *  - the caret stays on the character the user was at.
 */

const SENTENCE = 'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। ';
const LONG_PARA = 'यह एक बहुत लंबा पैराग्राफ है जो कई पंक्तियों में लपेटा जाएगा। ';

test.describe('Diary pagination reflow', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await disableTranslit(page);
  });

  test.afterEach(async ({ page }) => {
    // The pager must always settle without hitting its loop guard.
    const stats = await page.evaluate(() => window.__bpTest.stats());
    expect(stats.capHits).toBe(0);
  });

  test('open-repair spills an overflowing single page without leaving clip', async ({ page }) => {
    const paras = Array.from({ length: 40 }, () => SENTENCE.repeat(8));
    await setDoc(page, [{ right: paras }]);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page)).toEqual(paras);
  });

  test('healthy two-page diary is not re-cut on open', async ({ page }) => {
    await setDoc(page, [
      { left: ['बायाँ एक'], right: ['पृष्ठ एक की पहली पंक्ति।'] },
      { left: ['बायाँ दो'], right: ['पृष्ठ दो की पहली पंक्ति।'] },
    ]);
    expect(await columnPages(page, 'left')).toEqual([['बायाँ एक'], ['बायाँ दो']]);
    expect(await columnPages(page, 'right')).toEqual([['पृष्ठ एक की पहली पंक्ति।'], ['पृष्ठ दो की पहली पंक्ति।']]);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('overflow on left column creates an extra page', async ({ page }) => {
    const lines = Array.from({ length: 40 }, () => 'लंबा परीक्षण पाठ जो पृष्ठ भर देता है। '.repeat(8));
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.insertText(lines[0]);
    for (let i = 1; i < 6; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.insertText(lines[i]);
    }
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page, 'left')).toEqual(lines.slice(0, 6));
    // The right column is untouched by the left column's spill (blank on every page).
    expect((await columnBlocks(page, 'right')).every((b) => b === '')).toBe(true);
  });

  test('Backspace at start of page 2 left merges into page 1', async ({ page }) => {
    await setDoc(page, [{ left: numberedLines(1, 200) }]);
    const pagesBefore = await columnPages(page, 'left');
    expect(pagesBefore.length).toBeGreaterThan(1);
    const lastOnPage1 = pagesBefore[0][pagesBefore[0].length - 1];
    const firstOnPage2 = pagesBefore[1][0];

    await setCaret(page, { page: 1, col: 'left', start: true });
    await page.keyboard.press('Backspace');
    await settle(page);

    const blocks = await columnBlocks(page, 'left');
    expect(blocks).toContain(`${lastOnPage1}${firstOnPage2}`);
    expect(await caret(page)).toMatchObject({ col: 'left', text: `${lastOnPage1}${firstOnPage2}`, offset: lastOnPage1.length });
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('Backspace on right column page 2 leaves caret at the merged text', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setDoc(page, [{ right: [...numberedLines(1, capacity), 'second-page'] }]);
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('Backspace');
    await settle(page);
    const merged = `${capacity}second-page`;
    expect(await columnBlocks(page)).toEqual([...numberedLines(1, capacity - 1), merged]);
    expect(await caret(page)).toMatchObject({ text: merged, offset: String(capacity).length });

    // Typing continues at the junction.
    await page.keyboard.type('|');
    expect((await caret(page)).text).toBe(`${capacity}|second-page`);
  });

  test('Backspace at a right-column page boundary keeps the caret in the page box', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setDoc(page, [{ right: [...numberedLines(1, capacity), 'x'] }]);
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('Backspace');
    await settle(page);
    const inBox = await page.evaluate(() => {
      const sel = getSelection();
      if (!sel?.rangeCount) return false;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const box = node?.closest('.bp-cell')?.getBoundingClientRect();
      return Boolean(box && r.top >= box.top - 1 && r.bottom <= box.bottom + 1);
    });
    expect(inBox).toBe(true);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('a reflow never moves a caret that is not in the moved text', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    // Caret mid-page; type enough to push the last lines to page 2.
    await setCaret(page, { page: 0, col: 'right', block: 5 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('mid');
    await settle(page);
    expect(await pageCount(page)).toBe(2);
    expect(await caret(page)).toMatchObject({ page: 0, text: 'mid', offset: 3 });
    expect(capacity).toBeGreaterThan(0);
  });

  test('Enter that pushes the last line to page 2 takes the caret with it', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right', block: capacity - 1, offset: 0 });
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await columnPages(page)).toEqual([[...numberedLines(1, capacity - 1), ''], [String(capacity)]]);
    expect(await caret(page)).toMatchObject({ page: 1, text: String(capacity), offset: 0 });
  });

  test('repeated Enter at the bottom of a full page never clips a page', async ({ page }) => {
    await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right' });
    // The pager reflows on the next frame; check after each reflow.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Enter');
      await settle(page);
      expect(await clippedBoxes(page)).toEqual([]);
    }
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect((await caret(page)).page).toBe(1);
  });

  test('Enter after the last line of a full page creates a blank next page', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await columnPages(page)).toEqual([numberedLines(1, capacity), ['']]);
    expect(await caret(page)).toMatchObject({ page: 1, text: '', offset: 0 });
  });

  // Regression: separate paragraphs welded together ("29 30 31 32" → "29303132")
  // after Enter above the last lines of a full page and one Backspace at the
  // top of page 2.
  test('Backspace after an Enter spill pulls lines back without welding them', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    const before = await columnBlocks(page);
    await setCaret(page, { page: 0, col: 'right', block: capacity - 4 });
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await pageCount(page)).toBe(2);
    await page.keyboard.press('Backspace');
    await settle(page);
    expect(await columnBlocks(page)).toEqual(before);
    expect(await columnPages(page)).toEqual([before]);
  });

  test('Enter at page edge does not jump main.main-content scroll', async ({ page }) => {
    await fillSinglePage(page, { lastLine: '33' });
    await setCaret(page, { page: 0, col: 'right' });
    const before = await page.evaluate(() => {
      const main = document.querySelector('main.main-content');
      const target = Math.min(120, Math.max(40, main.scrollHeight - main.clientHeight));
      main.scrollTop = target;
      return main.scrollTop;
    });
    expect(before).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await settle(page);
    const after = await page.evaluate(() => document.querySelector('main.main-content').scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test('letter template still opens after diary pagination', async ({ page }) => {
    await fillSinglePage(page);
    await switchTemplate(page, 'letter');
    await expect(page.locator('.editor-letter .letter-page')).toBeVisible();
  });

  test('paste after a mid-page line then ArrowDown never clips', async ({ page }) => {
    await fillSinglePage(page);
    const paste = 'मगर इन दोनों को उसी वक़्त बुलाते, जब दो आदमियों से एक का काम पाकर भी संतोष कर लेने के सिवा और कोई चारा न होता। अगर दोनो साधु होते, तो उन्हें संतोष और धैर्य के लिए, संयम और नियम की बिलकुल ज़रूरत न होती। यह तो इनकी प्रकृति थी। विचित्र जीवन था इनका! घर में मिट्टी के दो-चार बर्तन के सिवा कोई संपत्ति नहीं।';
    await setCaret(page, { page: 0, col: 'right', block: 21 });
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(paste);
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);

    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page)).toContain(paste);
  });

  test('paste large Hindi block never clips a diary page', async ({ page }) => {
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText(Array.from({ length: 25 }, () => SENTENCE.repeat(10)).join(''));
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('a long paragraph fills the remainder of the page, then continues; Backspace at the cut joins it back', async ({ page }) => {
    const capacity = await fillSinglePage(page, { freeLines: 3 });
    const marker = 'PASTE_MARKER_शुरुआत';
    const longPara = `${marker} ${LONG_PARA.repeat(35)}`;
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(longPara);
    await settle(page);

    const pages = await columnPages(page);
    expect(pages.length).toBeGreaterThan(1);
    // The paragraph starts on page 1 (filling its free lines) and continues.
    expect(pages[0][pages[0].length - 1].startsWith(marker)).toBe(true);
    expect(pages[1][0].startsWith('+')).toBe(true);
    expect(await columnBlocks(page)).toEqual([...numberedLines(1, capacity - 3), longPara]);
    expect(await clippedBoxes(page)).toEqual([]);

    // Backspace at the top of page 2 deletes the character before the page
    // edge — the same paragraph, as in one continuous column.
    const head = pages[0][pages[0].length - 1];
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('Backspace');
    await settle(page);
    const blocks = await columnBlocks(page);
    expect(blocks).toHaveLength(capacity - 2);
    expect(blocks[blocks.length - 1]).toBe(longPara.slice(0, head.length - 1) + longPara.slice(head.length));
    // The caret sits where the character was — never inside a Devanagari cluster.
    const c = await caret(page);
    expect(c.text.slice(0, c.offset).endsWith(longPara.slice(head.length - 10, head.length - 1))).toBe(true);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('justified spill stays one paragraph; Backspace absorbs into page 1', async ({ page }) => {
    const capacity = await fillSinglePage(page, { freeLines: 3 });
    const long = LONG_PARA.repeat(40).trim();
    await setDoc(page, [{ right: [...numberedLines(1, capacity - 3), { t: long, align: 'justify' }] }]);
    const pages = await columnPages(page);
    expect(pages.length).toBeGreaterThan(1);
    expect(await columnBlocks(page)).toEqual([...numberedLines(1, capacity - 3), long]);
    // Every piece of the paragraph keeps its alignment.
    const aligns = await page.evaluate(() => [...document.querySelectorAll('.editor-diary .bp-cell[data-col="right"] p')]
      .filter((p) => p.textContent.includes('लंबा')).map((p) => p.style.textAlign));
    expect(new Set(aligns)).toEqual(new Set(['justify']));

    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('Backspace');
    await settle(page);
    const after = await columnBlocks(page);
    expect(after).toHaveLength(capacity - 2);
    expect(after[after.length - 1].length).toBe(long.length - 1);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('Enter on aligned page 1 does not leave blank gaps between page 2 content lines', async ({ page }) => {
    const capacity = await fillSinglePage(page, { freeLines: 2 });
    const long = LONG_PARA.repeat(35).trim();
    await setDoc(page, [{ right: [...numberedLines(1, capacity - 2), { t: long, align: 'right' }] }]);
    expect(await pageCount(page)).toBeGreaterThan(1);
    await setCaret(page, { page: 0, col: 'right', offset: 0 });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);

    const page2 = (await columnPages(page))[1];
    const firstContent = page2.findIndex((b) => b.replace(/^\+/, '').trim());
    const afterContent = page2.slice(firstContent);
    // Intentional blank lines may lead page 2; none appear between its text.
    expect(afterContent.every((b) => b.replace(/^\+/, '').trim())).toBe(true);
    expect(afterContent.length).toBeLessThanOrEqual(2);
  });

  test('showing header on a full page spills instead of clipping', async ({ page }) => {
    const paras = Array.from({ length: 35 }, () => SENTENCE.repeat(6));
    await setDoc(page, [{ hasHeader: false, right: paras }]);
    await page.locator('.diary-page').first().locator('.diary-header-toggle').click();
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page)).toEqual(paras);
  });

  test('save/load round-trip keeps pages, cuts and text', async ({ page }) => {
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText(Array.from({ length: 14 }, () => SENTENCE.repeat(6)).join(''));
    await settle(page);
    const before = await columnPages(page);
    expect(before.length).toBeGreaterThan(1);
    await page.waitForTimeout(900); // autosave
    const stored = await page.evaluate(() => window.__bpTest.content());
    expect(JSON.parse(stored)).toMatchObject({ format: 'bp-doc', v: 1 });

    await page.reload();
    await page.waitForFunction(() => window.__uxInitComplete === true);
    await settle(page);
    expect(await columnPages(page)).toEqual(before);
  });

  test('Enter at start of last right line spills instead of clipping', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right', block: capacity - 1, offset: 0 });
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page)).toEqual([...numberedLines(1, capacity - 1), '', String(capacity)]);
  });

  test('Enter at end of last right line spills blanks without clipping', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setCaret(page, { page: 0, col: 'right' });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await columnBlocks(page)).toEqual([...numberedLines(1, capacity), '', '', '']);
  });

  test('Enter after absorb to-and-fro does not clip', async ({ page }) => {
    await setDoc(page, [{ right: Array.from({ length: 14 }, () => SENTENCE.repeat(6)) }]);
    expect(await pageCount(page)).toBeGreaterThan(1);
    // Free slack on page 1 so text flows back, then Enter mid-page.
    await setCaret(page, { page: 0, col: 'right', block: 2 });
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await setCaret(page, { page: 0, col: 'right', block: 4, offset: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('left page-1 slack absorbs the next page\'s lines after an edit', async ({ page }) => {
    const marker = 'मगर इन दोनों को उसी';
    await setDoc(page, [
      { left: ['छोटी पंक्ति।'] },
      { left: [marker, 'दूसरी पंक्ति'] },
    ]);
    // Opening keeps the stored layout…
    expect(await columnPages(page, 'left')).toEqual([['छोटी पंक्ति।'], [marker, 'दूसरी पंक्ति']]);
    // …and an edit on page 1 pulls the later lines back into its free space.
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.type('!');
    await settle(page);
    expect(await columnPages(page, 'left')).toEqual([['छोटी पंक्ति।!', marker, 'दूसरी पंक्ति']]);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('left Enter on full page spills without clipping', async ({ page }) => {
    await setDoc(page, [{ left: numberedLines(1, 100) }]);
    const capacity = (await columnPages(page, 'left'))[0].length;
    await setDoc(page, [{ left: numberedLines(1, capacity) }]);
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await settle(page);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(await caret(page)).toMatchObject({ page: 1, col: 'left', text: 'next' });
  });

  test('blank lines on the last page survive moving to another page and reloading', async ({ page }) => {
    await setDoc(page, [{ right: [...Array.from({ length: 12 }, () => SENTENCE.repeat(6)), 'end'] }]);
    const last = (await pageCount(page)) - 1;
    await setCaret(page, { page: last, col: 'right' });
    for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
    await settle(page);
    await setCaret(page, { page: 0, col: 'right', block: 0, offset: 0 });
    await settle(page);
    const blocks = await columnBlocks(page);
    expect(blocks.slice(-5)).toEqual(['end', '', '', '', '']);
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForFunction(() => window.__uxInitComplete === true);
    await settle(page);
    expect((await columnBlocks(page)).slice(-5)).toEqual(['end', '', '', '', '']);
  });

  test('undo restores a page-1 edit after moving to another page', async ({ page }) => {
    const capacity = await fillSinglePage(page);
    await setDoc(page, [{ right: [...numberedLines(1, capacity), 'पृष्ठ दो मूल पाठ।'] }]);
    const before = await columnPages(page);
    await setCaret(page, { page: 0, col: 'right', block: 3 });
    await page.keyboard.type('UN');
    await settle(page);
    await setCaret(page, { page: 1, col: 'right', start: true });
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await columnPages(page)).toEqual(before);
    expect(await caret(page)).toMatchObject({ page: 0, text: '4', offset: 1 });
  });

  test('undo/redo a paste that spilled onto a second page', async ({ page }) => {
    await fillSinglePage(page, { freeLines: 1 });
    const before = await columnPages(page);
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(LONG_PARA.repeat(40));
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);

    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await columnPages(page)).toEqual(before);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('undo restores a left-column spill', async ({ page }) => {
    await setDoc(page, [{ left: ['seed'] }]);
    await setCaret(page, { page: 0, col: 'left' });
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(Array.from({ length: 80 }, (_, i) => `left-line-${i + 1}`).join(' '));
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(1);
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await columnPages(page, 'left')).toEqual([['seed']]);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('clicking into another page while the pager is still settling keeps the caret', async ({ page }) => {
    // The edit and the click land in the same task, inside the frame before
    // the pager runs: the user's click is the newer intent and must win.
    await setDoc(page, [{ right: Array.from({ length: 30 }, () => SENTENCE.repeat(6)) }]);
    const placed = await page.evaluate(() => {
      const ed = window.__bpDiarySheet.editor;
      window.__bpTest.setCaret({ page: 0, col: 'right', block: 0, offset: 0 });
      ed.commands.insertContent('x'.repeat(200));
      window.__bpTest.setCaret({ page: 1, col: 'right', block: 0, offset: 3 });
      return window.__bpTest.caret();
    });
    expect(placed).toMatchObject({ page: 1, offset: 3 });

    // Sample every frame for ~2s: the caret must never leave the characters
    // the click put it between. (Its offset within the paragraph may change
    // when the pager re-joins a cut paragraph in front of it.)
    const around = (c) => `${c.text.slice(Math.max(0, c.offset - 3), c.offset)}|${c.text.slice(c.offset, c.offset + 12)}`;
    const want = around(placed);
    const stray = await page.evaluate(({ wanted, src }) => new Promise((resolve) => {
      const aroundFn = new Function('c', `return (${src})(c)`);
      const bad = [];
      let frames = 0;
      const tick = () => {
        frames += 1;
        const c = window.__bpTest.caret();
        const got = aroundFn(c);
        if (got !== wanted || !c.focused) bad.push({ frames, got, page: c.page });
        if (frames < 120) requestAnimationFrame(tick);
        else resolve(bad);
      };
      requestAnimationFrame(tick);
    }), { wanted: want, src: around.toString() });
    expect(stray).toEqual([]);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('each column flows on its own: a long left column does not move the right one', async ({ page }) => {
    await setDoc(page, [{ left: numberedLines(1, 150), right: ['r1', 'r2'] }]);
    expect((await columnPages(page, 'left')).length).toBeGreaterThan(1);
    const right = await columnPages(page, 'right');
    expect(right[0]).toEqual(['r1', 'r2']);
    expect(right.slice(1).every((p) => p.length === 1 && p[0] === '')).toBe(true);
  });

  test('a numbered list cut across pages keeps counting', async ({ page }) => {
    const capacity = await fillSinglePage(page, { freeLines: 2 });
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.press('Enter');
    await page.locator('#formatToolbar [data-cmd="list:ordered"]').click();
    for (let i = 1; i <= 6; i++) {
      await page.keyboard.type(`item ${i}`);
      if (i < 6) await page.keyboard.press('Enter');
    }
    await settle(page);
    const numbers = await page.evaluate(() => [...document.querySelectorAll('.editor-diary .bp-cell[data-col="right"] ol')]
      .map((ol) => ({ start: Number(ol.getAttribute('start') || 1), items: ol.children.length })));
    expect(numbers.length).toBe(2);
    expect(numbers[1].start).toBe(numbers[0].start + numbers[0].items);
    expect(numbers[0].items + numbers[1].items).toBe(6);
    expect(await clippedBoxes(page)).toEqual([]);
    expect(capacity).toBeGreaterThan(2);
  });

  test('a large paste settles in one go across many pages', async ({ page }) => {
    await setCaret(page, { page: 0, col: 'right' });
    await page.keyboard.insertText(Array.from({ length: 300 }, (_, i) => `पंक्ति ${i + 1} — ${SENTENCE}`).join(''));
    await settle(page);
    expect(await pageCount(page)).toBeGreaterThan(3);
    expect(await clippedBoxes(page)).toEqual([]);
  });

  test('an image taller than a whole box gets a page of its own; text after it flows on', async ({ page }) => {
    const tall = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="3000"><rect width="100" height="3000" fill="#ccc"/></svg>')}`;
    await page.evaluate((src) => {
      const ed = window.__bpDiarySheet.editor;
      window.__bpTest.setCaret({ page: 0, col: 'right' });
      ed.commands.insertContent([{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }, { type: 'image', attrs: { src } }, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }]);
    }, tall);
    await settle(page);
    // CSS caps an image at one box, so it moves to its own page and fits.
    expect(await clippedBoxes(page)).toEqual([]);
    const blocks = await columnBlocks(page);
    expect(blocks.indexOf('before')).toBeLessThan(blocks.indexOf('after'));
    const imgPage = await page.evaluate(() => [...document.querySelectorAll('.editor-diary .diary-page')]
      .findIndex((p) => p.querySelector('.bp-cell img')));
    expect(imgPage).toBeGreaterThanOrEqual(0);
  });
});
