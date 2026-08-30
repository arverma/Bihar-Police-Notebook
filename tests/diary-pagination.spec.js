import { test, expect } from '@playwright/test';
import {
  clippedDiaryBoxes,
  disableTranslit,
  fillSinglePage,
  installDiaryQuillHelper,
  rightColumnBlocks,
} from './pagination-helpers.js';

async function setLeftColumnText(page, pageIndex, text) {
  await page.evaluate(({ pageIndex: i, text: value }) => {
    const pageEl = document.querySelectorAll('.diary-page')[i];
    const ta = pageEl?.querySelector('[data-col="left"]');
    if (!(ta instanceof HTMLTextAreaElement)) throw new Error('left textarea missing');
    ta.focus();
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, { pageIndex, text });
}

test.describe('Diary pagination reflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.editor-diary .diary-page');
    await disableTranslit(page);
    await page.waitForFunction(() => window.__bpDiarySheet != null);
    await installDiaryQuillHelper(page);
  });

  test('open-repair spills an overflowing single page without leaving clip', async ({ page }) => {
    const huge = `<p>${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(8)}</p>`.repeat(40);
    await page.evaluate((right) => {
      window.__bpDiarySheet.setModel({
        pages: [{
          hasHeader: true,
          header: {
            fir_number: '', thana: '', district: '', case_diary_no: '',
            rule_no: '', against_1: '', against_2: '', special_report_no: '',
            fir_date: '', event_date_place: '', sections: '', investigation_record: '',
          },
          left: '',
          right,
        }],
      });
    }, huge);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });

  test('healthy two-page diary is not re-cut on open', async ({ page }) => {
    const line1 = '<p>पृष्ठ एक की पहली पंक्ति।</p>';
    const line2 = '<p>पृष्ठ दो की पहली पंक्ति।</p>';
    await page.evaluate(({ a, b }) => {
      window.__bpDiarySheet.setModel({
        pages: [
          {
            hasHeader: true,
            header: {
              fir_number: '', thana: '', district: '', case_diary_no: '',
              rule_no: '', against_1: '', against_2: '', special_report_no: '',
              fir_date: '', event_date_place: '', sections: '', investigation_record: '',
            },
            left: 'बायाँ एक',
            right: a,
          },
          {
            hasHeader: false,
            header: null,
            left: 'बायाँ दो',
            right: b,
          },
        ],
      });
    }, { a: line1, b: line2 });

    await page.waitForTimeout(400);
    expect(await page.locator('.diary-page').count()).toBe(2);

    const snap = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.diary-page')];
      return pages.map((p) => ({
        left: p.querySelector('[data-col="left"]')?.value ?? '',
        rightHead: (
          window.Quill.find(p.querySelector('[data-col="right"]'))?.getText()
          || p.querySelector('[data-col="right"] .ql-editor')?.innerText
          || ''
        ).slice(0, 40),
      }));
    });
    expect(snap).toHaveLength(2);
    expect(snap[0].left).toBe('बायाँ एक');
    expect(snap[1].left).toBe('बायाँ दो');
    expect(snap[0].rightHead).toContain('पृष्ठ एक');
    expect(snap[1].rightHead).toContain('पृष्ठ दो');
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('overflow on left column creates an extra page', async ({ page }) => {
    const filler = `${'लंबा परीक्षण पाठ जो पृष्ठ भर देता है। '.repeat(8)}\n`.repeat(40);
    await setLeftColumnText(page, 0, filler);

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);

    await expect.poll(async () => {
      return page.locator('.diary-page').nth(0).locator('[data-col="left"]').evaluate(
        (el) => el.scrollHeight <= el.clientHeight + 1,
      );
    }).toBe(true);
  });

  test('Backspace at start of page 2 left merges into page 1', async ({ page }) => {
    const filler = `${'पंक्ति परीक्षण। '.repeat(10)}\n`.repeat(35);
    await setLeftColumnText(page, 0, filler);

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);

    const left0 = page.locator('.diary-page').nth(0).locator('[data-col="left"]');
    const left1 = page.locator('.diary-page').nth(1).locator('[data-col="left"]');
    const beforeP0 = await left0.inputValue();
    const beforeP1 = await left1.inputValue();
    expect(beforeP1.length).toBeGreaterThan(0);

    await left1.click();
    await left1.evaluate((el) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await left1.press('Backspace');

    await expect.poll(async () => {
      const p0 = await page.locator('.diary-page').nth(0).locator('[data-col="left"]').inputValue();
      const p1 = await page.locator('.diary-page').nth(1).locator('[data-col="left"]').inputValue().catch(() => '');
      return p0 !== beforeP0 || p1 !== beforeP1;
    }).toBe(true);

    const afterP0 = await page.locator('.diary-page').nth(0).locator('[data-col="left"]').inputValue();
    expect(afterP0.length).not.toBe(beforeP0.length);
  });

  test('Backspace on right column page 2 leaves caret at the merged text', async ({ page }) => {
    // Overflow page 1 so page 2 is created the way it is in real use.
    await page.evaluate((text) => {
      const quill = window.__q(0);
      if (!quill) throw new Error('page 1 quill missing');
      quill.focus();
      quill.setText(text);
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(30));

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    // Reflow must be finished before we place the caret, or a late spill moves
    // it and Backspace deletes a character instead of merging the boundary.
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    // The text the caret sits in front of must not change, whether page 2's
    // line merges back into page 1 or stays put.
    const ahead = await page.evaluate(() => {
      const quill = window.__q(1);
      if (!quill) throw new Error('page 2 quill missing');
      quill.focus();
      quill.setSelection(0, 0);
      return quill.getText().slice(0, 24);
    });
    expect(ahead.trim().length).toBeGreaterThan(0);
    await expect.poll(async () => page.evaluate(() => {
      const q = window.__liveQ(1);
      return q?.hasFocus() ? q.getSelection()?.index ?? null : null;
    }), { timeout: 10000 }).toBe(0);

    await page.locator('.diary-page').nth(1).locator('.ql-editor').press('Backspace');

    await expect.poll(async () => page.evaluate((expected) => {
      const n = document.querySelectorAll('.diary-page').length;
      let quill = null;
      for (let i = 0; i < n; i++) {
        // __liveQ, not __q: activating a static page would move the caret we
        // are asking about.
        const candidate = window.__liveQ(i);
        if (candidate?.hasFocus()) {
          quill = candidate;
          break;
        }
      }
      if (!quill) return 'no-focused-editor';
      const sel = quill.getSelection();
      if (!sel) return 'no-selection';
      return quill.getText().slice(sel.index, sel.index + expected.length) === expected
        ? 'caret-at-expected-text'
        : 'caret-misplaced';
    }, ahead), { timeout: 15000 }).toBe('caret-at-expected-text');
  });

  test('Backspace at a right-column page boundary keeps the caret in the page box', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Overflow page 1 so page 2 exists, then trim page 2 to a single short
    // line and leave blank lines at the end of page 1. That is the shape that
    // used to merge the line into a clipped position with no caret.
    await page.evaluate((text) => {
      const q = window.__q(0);
      q.focus();
      q.setText(text, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(14));
    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);

    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(Math.max(0, q.getLength() - 1), 0);
    });
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    }

    // Pin a short line on page 2 via the model so absorb cannot collapse it
    // before the boundary Backspace under continuous-right.
    await page.evaluate(() => {
      const m = window.__bpDiarySheet.getModel();
      if (m.pages.length < 2) {
        m.pages.push({ hasHeader: false, header: null, left: '', right: '' });
      }
      m.pages = m.pages.slice(0, 2);
      m.pages[1].right = '<p>यही बात है</p>';
      window.__bpDiarySheet.setModel(m);
    });
    await page.waitForTimeout(300);
    expect(await page.locator('.diary-page').count()).toBeGreaterThan(1);

    await page.evaluate(() => {
      const q = window.__q(1);
      q.focus();
      q.setSelection(0, 0);
    });
    const scrollBefore = await page.evaluate(
      () => document.querySelector('main.main-content').scrollTop,
    );
    await page.locator('.diary-page').nth(1).locator('.ql-editor').press('Backspace');
    await page.waitForTimeout(700);

    const caret = await page.evaluate(() => {
      const n = document.querySelectorAll('.diary-page').length;
      let q = null;
      for (let i = 0; i < n; i++) {
        const candidate = window.__liveQ(i);
        if (candidate?.hasFocus()) {
          q = candidate;
          break;
        }
      }
      if (!q) return { reason: 'no-focused-editor' };
      const sel = q.getSelection();
      if (!sel) return { reason: 'focused-editor-has-no-selection' };

      const editorRect = q.root.getBoundingClientRect();
      const scale = q.root.offsetHeight ? editorRect.height / q.root.offsetHeight : 1;
      const b = q.getBounds(sel.index, 0);
      const caretBottom = editorRect.top + b.bottom * scale;

      return {
        reason: 'ok',
        // The caret must land on rendered text, not in a clipped overhang.
        insideBox: caretBottom <= editorRect.bottom + 1,
        editorScrollTop: q.root.scrollTop,
        stageScrollTop: document.querySelector('main.main-content').scrollTop,
      };
    });

    expect(caret.reason).toBe('ok');
    expect(caret.insideBox).toBe(true);
    expect(caret.editorScrollTop).toBe(0);
    // Restoring the caret must never scroll the stage for the user.
    expect(caret.stageScrollTop).toBe(scrollBefore);
    expect(errors).toEqual([]);
  });

  test('offscreen fit measurement does not steal the caret', async ({ page }) => {
    const before = await page.evaluate(() => {
      const host = document.querySelectorAll('.diary-page')[0]
        ?.querySelector('[data-col="right"]');
      const quill = host && window.Quill ? window.Quill.find(host) : null;
      if (!quill) throw new Error('page 1 quill missing');
      quill.setText('कुछ पाठ यहाँ लिखा है\n', 'user');
      quill.setSelection(4, 0, 'api');
      return { sel: quill.getSelection(), hasFocus: quill.hasFocus() };
    });
    expect(before.sel).toEqual({ index: 4, length: 0 });
    expect(before.hasFocus).toBe(true);

    // Measuring content in the offscreen mirror must not touch the document
    // selection, or the caret vanishes from the editor the user is typing in.
    const after = await page.evaluate(async () => {
      const mod = await import('./js/quill-pages.js');
      mod.splitRichToFit(
        `${'<p>यह एक लंबा वाक्य है जो पृष्ठ को भर देता है।</p>'.repeat(40)}`,
        544,
        795,
        { fontSize: 16, lineHeight: 24, padding: '4px 6px' },
      );

      const host = document.querySelectorAll('.diary-page')[0]
        ?.querySelector('[data-col="right"]');
      const quill = window.Quill.find(host);
      const domSel = window.getSelection();
      const anchorEl = domSel?.anchorNode?.nodeType === 1
        ? domSel.anchorNode
        : domSel?.anchorNode?.parentElement;
      return {
        sel: quill.getSelection(),
        hasFocus: quill.hasFocus(),
        anchorInEditor: Boolean(anchorEl && quill.root.contains(anchorEl)),
      };
    });

    expect(after.hasFocus).toBe(true);
    expect(after.sel).toEqual({ index: 4, length: 0 });
    expect(after.anchorInEditor).toBe(true);
  });

  test('Enter that pushes the last line to page 2 takes the caret with it', async ({ page }) => {
    const marker = 'यही बात है';
    const filler = `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(9);

    const setBody = async (blanks) => {
      await page.evaluate(({ f, n, m }) => {
        const q = window.__q(0);
        q.focus();
        q.setText(`${f}${'\n'.repeat(n)}${m}\n`, 'user');
      }, { f: filler, n: blanks, m: marker });
      await page.waitForTimeout(140);
    };

    // Grow the blank run until the marker is the last line of a full page 1.
    let blanks = 0;
    for (let n = 0; n <= 30; n++) {
      await setBody(n);
      if (await page.locator('.diary-page').count() > 1) break;
      blanks = n;
    }
    await setBody(blanks);
    await page.waitForTimeout(400);

    // Caret immediately before the marker, then a plain Enter.
    await page.evaluate((m) => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(q.getText().indexOf(m), 0, 'api');
    }, marker);
    await page.locator('.diary-page').nth(0).locator('.ql-editor').press('Enter');

    // The caret belongs wherever the marker ended up, right at its start.
    await expect.poll(async () => page.evaluate((m) => {
      const n = document.querySelectorAll('.diary-page').length;
      let focused = null;
      let holder = null;
      for (let i = 0; i < n; i++) {
        const host = document.querySelectorAll('.diary-page')[i]
          ?.querySelector('[data-col="right"]');
        const q = window.Quill.find(host);
        const text = q
          ? q.getText()
          : (host?.querySelector('.ql-editor')?.innerText || '');
        const markerAt = text.indexOf(m);
        if (markerAt >= 0) holder = { i, markerAt, q };
        if (q?.hasFocus()) focused = { i, q };
      }
      if (!focused) return 'no-focused-editor';
      if (!holder) return 'marker-missing';
      if (focused.i !== holder.i) return 'caret-on-wrong-page';
      const sel = focused.q.getSelection();
      if (!sel) return 'no-selection';
      return sel.index === holder.markerAt ? 'caret-at-marker' : `caret-off-by-${sel.index - holder.markerAt}`;
    }, marker), { timeout: 15000 }).toBe('caret-at-marker');
  });

  test('repeated Enter at the bottom of a full page never clips a page', async ({ page }) => {
    await page.evaluate(() => {
      window.__clipped = () => [...document.querySelectorAll('.diary-page .ql-editor')]
        .map((el, i) => ({
          page: i + 1,
          overflowPx: el.scrollHeight - el.clientHeight,
          scrollTop: el.scrollTop,
        }))
        .filter((p) => p.overflowPx > 1 || p.scrollTop > 0);
    });

    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      q.setText(t, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(14));
    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);
    await expect.poll(async () => page.evaluate(() => window.__clipped())).toEqual([]);

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const last = document.querySelectorAll('.diary-page').length - 1;
        const q = window.__q(last);
        q.focus();
        q.setSelection(Math.max(0, q.getLength() - 1), 0, 'api');
      });
      await page.keyboard.press('Enter');
      await expect.poll(
        async () => page.evaluate(() => window.__clipped()),
        { timeout: 10000 },
      ).toEqual([]);
    }

    expect(await page.evaluate(() => {
      const last = document.querySelectorAll('.diary-page').length - 1;
      const q = window.__q(last);
      if (!q.hasFocus()) return 'caret-left-the-last-page';
      if (q.getLength() <= 1) return 'blank-lines-collapsed';
      const sel = q.getSelection();
      if (!sel) return 'no-selection';
      return sel.index === q.getLength() - 1 ? 'caret-at-end' : `caret-off-by-${sel.index - (q.getLength() - 1)}`;
    })).toBe('caret-at-end');
  });


  test('Enter after the last line of a full page creates a blank next page', async ({ page }) => {
    await fillSinglePage(page, { lastLine: '33' });
    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(q.getLength() - 1, 0, 'api');
    });
    await expect.poll(async () => page.locator('.diary-page').count()).toBe(1);

    await page.locator('.diary-page').nth(0).locator('.ql-editor').press('Enter');
    await page.waitForTimeout(500);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(2);

    const state = await page.evaluate(() => {
      const pages = window.__bpDiarySheet.getModel().pages;
      const p1 = pages[1]?.right || '';
      const n = document.querySelectorAll('.diary-page').length;
      let focused = -1;
      let sel = null;
      for (let i = 0; i < n; i++) {
        // __liveQ, not __q: activating a static page here would steal the caret
        // we are trying to observe.
        const q = window.__liveQ(i);
        if (q?.hasFocus()) {
          focused = i;
          sel = q.getSelection();
          break;
        }
      }
      return {
        pageCount: pages.length,
        page1Right: p1,
        focused,
        selIndex: sel?.index ?? null,
        selLength: sel?.length ?? null,
      };
    });

    expect(state.pageCount).toBeGreaterThanOrEqual(2);
    // Caret-owned blank spill must survive collapse. Quill's default empty doc
    // stores '' (same as a lone blank line); static fill still shows <p><br></p>.
    const normalized = (state.page1Right || '').replace(/\s+/g, '').toLowerCase();
    expect(normalized === '' || /<p><br\/?><\/p>/.test(normalized)).toBe(true);
    expect(state.focused).toBe(1);
    expect(state.selIndex).toBe(0);
    expect(state.selLength).toBe(0);
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('Backspace after an Enter spill pulls lines back without welding them', async ({ page }) => {
    await fillSinglePage(page);
    const before = await rightColumnBlocks(page);
    expect(before.length).toBeGreaterThan(8);
    const head = before.slice(0, before.length - 4);
    const tail = before.slice(-4);

    // Caret at the start of the 4th line from the end, then four Enters: the
    // blank lines stay on page 1 and push the last four lines onto page 2.
    await page.evaluate((keep) => {
      const q = window.__q(0);
      q.focus();
      const lines = q.getText().split('\n').slice(0, -1);
      q.setSelection(lines.slice(0, keep).join('\n').length + 1, 0, 'api');
    }, head.length);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }
    expect(await rightColumnBlocks(page)).toEqual([...head, '', '', '', '', ...tail]);

    // The caret must be at the very start of page 2 so Backspace hits the
    // page boundary rather than deleting a character.
    await expect.poll(async () => page.evaluate(() => {
      const q = window.__liveQ(1);
      return q?.hasFocus() ? q.getSelection()?.index ?? null : null;
    }), { timeout: 10000 }).toBe(0);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);

    // One blank line goes; every other line survives as its own block. Absorb
    // used to weld the pulled-back lines onto one line ("29303132").
    expect(await rightColumnBlocks(page)).toEqual([...head, '', '', '', ...tail]);
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('Enter at page edge does not jump main.main-content scroll', async ({ page }) => {
    await fillSinglePage(page, { lastLine: '33' });
    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(q.getLength() - 1, 0, 'api');
    });

    // Scroll stage so we can detect a jump.
    const before = await page.evaluate(() => {
      const main = document.querySelector('main.main-content');
      if (!(main instanceof HTMLElement)) return null;
      const target = Math.min(120, Math.max(40, main.scrollHeight - main.clientHeight));
      main.scrollTop = target;
      return main.scrollTop;
    });
    expect(before).not.toBeNull();
    expect(before).toBeGreaterThan(0);

    await page.locator('.diary-page').nth(0).locator('.ql-editor').press('Enter');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const main = document.querySelector('main.main-content');
      return main instanceof HTMLElement ? main.scrollTop : -1;
    });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test('letter template still opens after diary pagination', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    const letterBtn = page.getByRole('button', { name: 'Letter' });
    await letterBtn.click();
    await expect(page.locator('.editor-letter')).toBeVisible({ timeout: 5000 });
  });

  test('paste after mid-page line then ArrowDown never clips from top', async ({ page }) => {
    await fillSinglePage(page);
    await expect.poll(async () => page.locator('.diary-page').count()).toBe(1);

    const paste = 'मगर इन दोनों को उसी वक़्त बुलाते, जब दो आदमियों से एक का काम पाकर भी संतोष कर लेने के सिवा और कोई चारा न होता। अगर दोनो साधु होते, तो उन्हें संतोष और धैर्य के लिए, संयम और नियम की बिलकुल ज़रूरत न होती। यह तो इनकी प्रकृति थी। विचित्र जीवन था इनका! घर में मिट्टी के दो-चार बर्तन के सिवा कोई संपत्ति नहीं।';

    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      const text = q.getText();
      const needle = '22\n';
      let at = text.indexOf(needle);
      if (at < 0) {
        // Capacity may not include 22 — paste after ~70% of the page.
        at = Math.floor(Math.max(0, q.getLength() - 1) * 0.7);
      } else {
        at += needle.length;
      }
      q.setSelection(at, 0, 'api');
      q.insertText(at, `${t}\n`, 'user');
    }, paste);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    // Caret toward end of page 0, then ArrowDown — must not scroll the fixed box.
    await page.evaluate(() => {
      const q = window.__liveQ(0) || window.__q(0);
      q.focus();
      const end = Math.max(0, q.getLength() - 1);
      q.setSelection(end, 0, 'user');
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Simulate the browser trying to reveal the caret by scrolling the editor.
    await page.evaluate(() => {
      const q = window.__liveQ(0);
      if (q) q.root.scrollTop = 80;
    });
    await page.waitForTimeout(100);

    const clip = await clippedDiaryBoxes(page);
    expect(clip).toEqual([]);
    const tops = await page.evaluate(() => [...document.querySelectorAll('.diary-page [data-col="right"] .ql-editor')]
      .map((el) => el.scrollTop));
    expect(tops.every((t) => t === 0)).toBe(true);

    const joined = await page.evaluate(() => window.__bpDiarySheet.getModel().pages
      .map((p) => p.right || '')
      .join(''));
    expect(joined).toContain('मगर इन दोनों');
    expect(joined).toContain('कोई संपत्ति नहीं');
  });

  test('paste large Hindi block never clips a diary page', async ({ page }) => {
    const block = `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(10)}\n`.repeat(25);
    await page.evaluate((t) => {
      const q = window.Quill.find(
        document.querySelector('.diary-page [data-col="right"]'),
      );
      q.focus();
      q.setText(t, 'user');
    }, block);
    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });

  test('mid-paragraph paste fills remainder; Backspace pulls when slack', async ({ page }) => {
    // Nearly fill page 0, leaving a few lines of slack for the paste to use.
    await fillSinglePage(page, { freeLines: 3 });
    await expect.poll(async () => page.locator('.diary-page').count()).toBe(1);

    const pasteMarker = 'PASTE_MARKER_शुरुआत';
    const longPara = `${pasteMarker} ${'यह एक बहुत लंबा पैराग्राफ है जो कई पंक्तियों में लपेटा जाएगा। '.repeat(35)}`;
    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      const at = Math.max(0, q.getLength() - 1);
      q.setSelection(at, 0);
      q.insertText(at, `\n${t}`, 'user');
    }, longPara);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    const afterPaste = await page.evaluate((marker) => {
      const pages = [...document.querySelectorAll('.diary-page')];
      const eds = pages.map((p) => p.querySelector('[data-col="right"] .ql-editor'));
      const e0 = eds[0];
      const fill = e0.clientHeight ? e0.scrollHeight / e0.clientHeight : 0;
      const plain = eds.map((e) => (e?.innerText || '').replace(/\n/g, '')).join('');
      return {
        fill,
        hasMarker: plain.includes(marker),
        markerOnPage0: (eds[0]?.innerText || '').includes(marker),
        page1HasContinuation: (eds[1]?.innerText || '').trim().length > 0,
      };
    }, pasteMarker);
    expect(afterPaste.fill).toBeGreaterThan(0.85);
    expect(afterPaste.hasMarker).toBe(true);
    expect(afterPaste.markerOnPage0).toBe(true);
    expect(afterPaste.page1HasContinuation).toBe(true);

    // After a mid-paragraph fill, page 0 is typically full — free slack by
    // dropping early filler blocks so absorb-first Backspace can pull.
    await page.evaluate(() => {
      const m = window.__bpDiarySheet.getModel();
      const html = m.pages[0].right || '';
      const parts = html.split(/(?=<p\b)/i).filter(Boolean);
      if (parts.length > 10) {
        m.pages[0].right = parts.slice(8).join('');
        window.__bpDiarySheet.setModel(m);
      }
    });
    await page.waitForTimeout(400);

    const beforeBs = await page.evaluate(() => {
      const m = window.__bpDiarySheet.getModel();
      const plain = (html) => String(html || '').replace(/<[^>]+>/g, '');
      return {
        p0: m.pages[0].right,
        p1: m.pages[1]?.right || '',
        p0plain: plain(m.pages[0].right),
        p1plain: plain(m.pages[1]?.right || ''),
      };
    });

    await page.evaluate(() => {
      const q = window.__q(1);
      q.focus();
      q.setSelection(0, 0);
    });
    const ahead = await page.evaluate(() => window.__q(1).getText().slice(0, 24));
    expect(ahead.trim().length).toBeGreaterThan(0);

    await page.locator('.diary-page').nth(1).locator('.ql-editor').press('Backspace');
    await page.waitForTimeout(800);

    const afterBs = await page.evaluate((expected) => {
      const m = window.__bpDiarySheet.getModel();
      const plain = (html) => String(html || '').replace(/<[^>]+>/g, '');
      const p0plain = plain(m.pages[0].right);
      const p1plain = plain(m.pages[1]?.right || '');
      let caretOk = false;
      let midCluster = false;
      for (let i = 0; i < m.pages.length; i++) {
        const q = window.__liveQ(i);
        if (!q?.hasFocus()) continue;
        const sel = q.getSelection();
        if (!sel) continue;
        const text = q.getText();
        caretOk = text.slice(sel.index, sel.index + expected.length) === expected;
        // Off-by-one into Devanagari would put caret after first code unit of "कई".
        if (expected.startsWith('कई') && text.slice(sel.index, sel.index + 1) === 'ई') {
          midCluster = true;
        }
      }
      return {
        p0: m.pages[0].right,
        p1: m.pages[1]?.right || '',
        p0plain,
        p1plain,
        caretOk,
        midCluster,
        pageCount: m.pages.length,
      };
    }, ahead);

    // Must not only delete the last char of page 0 while page 1 stays unchanged.
    const eatenOnly = afterBs.p1 === beforeBs.p1
      && afterBs.p0plain === beforeBs.p0plain.slice(0, -1);
    expect(eatenOnly).toBe(false);
    expect(
      afterBs.p1plain.length < beforeBs.p1plain.length
      || afterBs.pageCount < 2
      || afterBs.p0plain.length > beforeBs.p0plain.length,
    ).toBe(true);
    expect(afterBs.midCluster).toBe(false);
    expect(afterBs.caretOk).toBe(true);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });

  test('showing header on a full page spills instead of clipping', async ({ page }) => {
    await page.evaluate((t) => {
      window.__bpDiarySheet.setModel({
        pages: [{
          hasHeader: false,
          header: null,
          left: '',
          right: `<p>${t}</p>`.repeat(35),
        }],
      });
    }, 'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6));

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(0);
    await page.waitForTimeout(300);

    const toggle = page.locator('.diary-page').nth(0).locator('.diary-header-toggle');
    if (await toggle.count()) {
      await toggle.click();
    } else {
      await page.evaluate(() => {
        const m = window.__bpDiarySheet.getModel();
        m.pages[0].hasHeader = true;
        m.pages[0].header = m.pages[0].header || {
          fir_number: '', thana: '', district: '', case_diary_no: '',
          rule_no: '', against_1: '', against_2: '', special_report_no: '',
          fir_date: '', event_date_place: '', sections: '', investigation_record: '',
        };
        window.__bpDiarySheet.setModel(m);
      });
    }

    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 15000 }).toEqual([]);
  });

  test('continuous right: save/load round-trip keeps pages[] shape', async ({ page }) => {
    await disableTranslit(page);

    await page.evaluate((t) => {
      const q = window.Quill.find(
        document.querySelector('.diary-page [data-col="right"]'),
      );
      q.focus();
      q.setText(t, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(14));

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page)).toEqual([]);

    const model = await page.evaluate(() => window.__bpDiarySheet.getModel());
    expect(Array.isArray(model.pages)).toBe(true);
    expect(model.pages.length).toBeGreaterThan(1);
    expect(model.pages[0]).toHaveProperty('right');
    expect(model).not.toHaveProperty('rightStream');

    await page.evaluate((m) => window.__bpDiarySheet.setModel(m), model);
    await page.waitForTimeout(300);
    expect(await page.locator('.diary-page').count()).toBe(model.pages.length);
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('Enter at start of last right line spills instead of clipping', async ({ page }) => {
    const marker = 'यही बात है';
    await page.evaluate(({ t, m }) => {
      const q = window.__q(0);
      q.focus();
      q.setText(`${t}${m}`, 'user');
    }, {
      t: `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(12),
      m: marker,
    });

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page)).toEqual([]);

    await page.evaluate((m) => {
      const n = document.querySelectorAll('.diary-page').length;
      for (let i = 0; i < n; i++) {
        const q = window.__q(i);
        const at = q.getText().indexOf(m);
        if (at >= 0) {
          q.focus();
          q.setSelection(at, 0, 'api');
          return;
        }
      }
      throw new Error('marker missing');
    }, marker);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
    expect(await page.locator('.diary-page').count()).toBeGreaterThan(1);
  });

  test('Enter at end of last right line spills blanks without clipping', async ({ page }) => {
    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      q.setText(t, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(13));

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);

    await page.evaluate(() => {
      const last = document.querySelectorAll('.diary-page').length - 1;
      const q = window.__q(last);
      q.focus();
      q.setSelection(Math.max(0, q.getLength() - 1), 0, 'api');
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });

  test('Enter after absorb to-and-fro does not clip', async ({ page }) => {
    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      q.setText(t, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(14));

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page)).toEqual([]);

    // Free slack on page 0 so later pages absorb back (to-and-fro churn).
    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      const len = q.getLength();
      const del = Math.min(50, Math.max(1, len - 2));
      const at = Math.max(1, len - del - 1);
      q.deleteText(at, del, 'user');
    });
    await page.waitForTimeout(400);

    // Enter mid-page while height may still be settling after absorb.
    await page.evaluate(() => {
      const q = window.__q(0);
      q.focus();
      q.setSelection(Math.max(1, Math.floor(q.getLength() / 2)), 0, 'api');
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });

  test('left page-0 slack absorbs marker line from page 2', async ({ page }) => {
    const marker = 'मगर इन दोनों को उसी';
    await page.evaluate((m) => {
      window.__bpDiarySheet.setModel({
        pages: [
          {
            hasHeader: true,
            header: {
              fir_number: '', thana: '', district: '', case_diary_no: '',
              rule_no: '', against_1: '', against_2: '', special_report_no: '',
              fir_date: '', event_date_place: '', sections: '', investigation_record: '',
            },
            left: 'छोटी पंक्ति।\n',
            right: '',
          },
          {
            hasHeader: false,
            header: null,
            left: `${m}\nदूसरी पंक्ति\n`,
            right: '',
          },
        ],
      });
    }, marker);
    await page.waitForTimeout(300);

    // Editing page 0 with slack must pull page-2 lines back (absorbAround).
    await page.evaluate(() => {
      const ta = document.querySelector('.diary-page [data-col="left"]');
      ta.focus();
      ta.value = `${ta.value} `;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.value = ta.value.replace(/ $/, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    await expect.poll(async () => clippedDiaryBoxes(page)).toEqual([]);
    const restored = await page.evaluate((m) => {
      const ta0 = document.querySelectorAll('.diary-page [data-col="left"]')[0];
      return ta0 instanceof HTMLTextAreaElement && ta0.value.includes(m);
    }, marker);
    expect(restored).toBe(true);
  });

  test('left Enter on full page spills without clipping', async ({ page }) => {
    const marker = 'मगर इन दोनों को उसी';
    await page.evaluate((m) => {
      const ta = document.querySelector('.diary-page [data-col="left"]');
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error('left missing');
      const line = 'पंक्ति परीक्षण पाठ बायाँ कॉलम।\n';
      let n = 1;
      ta.value = line;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      while (n < 200 && ta.scrollHeight <= ta.clientHeight + 1) {
        n += 1;
        ta.value = line.repeat(n);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Back off one line and append marker so page is maxed with marker last.
      ta.value = `${line.repeat(Math.max(1, n - 1))}${m}\n`;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      const at = ta.value.indexOf(m);
      ta.focus();
      ta.setSelectionRange(at, at);
    }, marker);
    await page.waitForTimeout(200);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);
  });


  test('blank lines on last right page survive switching to another page', async ({ page }) => {
    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      q.setText(t, 'user');
    }, `${'यह एक लंबा वाक्य है जो पृष्ठ को भर देता है। '.repeat(6)}\n`.repeat(12));

    await expect.poll(async () => page.locator('.diary-page').count()).toBeGreaterThan(1);

    const blankCount = 4;
    await page.evaluate((n) => {
      const last = document.querySelectorAll('.diary-page').length - 1;
      const q = window.__q(last);
      q.focus();
      const end = Math.max(0, q.getLength() - 1);
      q.setSelection(end, 0, 'api');
      q.insertText(end, '\n'.repeat(n), 'user');
    }, blankCount);
    await page.waitForTimeout(400);

    const before = await page.evaluate(() => {
      const pages = document.querySelectorAll('.diary-page');
      const last = pages.length - 1;
      const editor = pages[last].querySelector('[data-col="right"] .ql-editor');
      const emptyPs = [...editor.querySelectorAll('p')].filter((p) => {
        const t = (p.textContent || '').replace(/\u00a0/g, ' ').trim();
        return !t && !p.querySelector('img');
      });
      return {
        last,
        emptyCount: emptyPs.length,
        html: editor.innerHTML,
        scrollHeight: editor.scrollHeight,
      };
    });
    expect(before.emptyCount).toBeGreaterThanOrEqual(blankCount);

    // Switch to page 0 — last page becomes a static clone.
    await page.evaluate(() => {
      const host = document.querySelectorAll('.diary-page')[0]
        ?.querySelector('[data-col="right"]');
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const after = await page.evaluate((lastIdx) => {
      const pages = document.querySelectorAll('.diary-page');
      const host = pages[lastIdx]?.querySelector('[data-col="right"]');
      const editor = host?.querySelector('.ql-editor');
      if (!editor) return { error: 'no editor' };
      const isStatic = host.dataset.staticRight === '1'
        || editor.getAttribute('contenteditable') === 'false';
      const emptyPs = [...editor.querySelectorAll('p')].filter((p) => {
        const t = (p.textContent || '').replace(/\u00a0/g, ' ').trim();
        return !t && !p.querySelector('img');
      });
      const brCount = editor.querySelectorAll('br').length;
      return {
        isStatic,
        emptyCount: emptyPs.length,
        brCount,
        html: editor.innerHTML,
        scrollHeight: editor.scrollHeight,
      };
    }, before.last);

    expect(after.error).toBeUndefined();
    expect(after.isStatic).toBe(true);
    expect(after.emptyCount).toBeGreaterThanOrEqual(blankCount);
    expect(after.brCount).toBeGreaterThanOrEqual(blankCount);
    // Blank lines must still occupy vertical space (not collapsed <p></p>).
    expect(after.scrollHeight).toBeGreaterThanOrEqual(before.scrollHeight - 4);
  });

  test('undo restores page-1 edit after focusing another page', async ({ page }) => {
    const marker = 'UNDO_PAGE_SWITCH_MARKER';
    // Page 0 must be full enough that absorb cannot pull page 1 away.
    await fillSinglePage(page);
    const page0 = await page.evaluate(() => window.__bpDiarySheet.getModel().pages[0].right);
    await page.evaluate(({ a, b }) => {
      window.__bpDiarySheet.setModel({
        pages: [
          {
            hasHeader: true,
            header: {
              fir_number: '', thana: '', district: '', case_diary_no: '',
              rule_no: '', against_1: '', against_2: '', special_report_no: '',
              fir_date: '', event_date_place: '', sections: '', investigation_record: '',
            },
            left: '',
            right: a,
          },
          {
            hasHeader: false,
            header: null,
            left: '',
            right: b,
          },
        ],
      });
    }, {
      a: page0,
      b: '<p>पृष्ठ दो मूल पाठ।</p>',
    });
    await expect.poll(async () => page.locator('.diary-page').count()).toBe(2);
    await page.waitForTimeout(300);

    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      // Replace last few chars so page stays full (no absorb of page 2).
      const end = Math.max(0, q.getLength() - 1);
      const from = Math.max(0, end - 2);
      q.deleteText(from, end - from, 'user');
      q.insertText(from, t.slice(0, 2), 'user');
    }, marker);
    await page.waitForTimeout(400);

    await expect.poll(async () => page.locator('.diary-page').count()).toBe(2);

    const withEdit = await page.evaluate(() => window.__bpDiarySheet.getModel().pages[0].right);
    expect(withEdit).toContain(marker.slice(0, 2));

    // Focus page 2 (static → live). Undo must still reverse the page-1 edit.
    await page.evaluate(() => {
      const host = document.querySelectorAll('.diary-page')[1]
        ?.querySelector('[data-col="right"]');
      if (!host) throw new Error('page 1 right host missing');
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    await page.waitForTimeout(200);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const m = window.__bpDiarySheet.getModel();
      return {
        pageCount: m.pages.length,
        p0: m.pages[0].right,
        p1: m.pages[1]?.right || '',
        liveOn0: Boolean(window.__liveQ(0)),
      };
    });
    expect(after.pageCount).toBe(2);
    expect(after.p0).toBe(page0);
    expect(after.p1).toContain('पृष्ठ दो');
    expect(after.liveOn0).toBe(true);
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('undo/redo paste that spilled onto a second page', async ({ page }) => {
    await fillSinglePage(page, { freeLines: 1 });
    await expect.poll(async () => page.locator('.diary-page').count()).toBe(1);
    const before = await page.evaluate(() => window.__bpDiarySheet.getModel().pages[0].right);

    const pasteBody = `${'यह एक बहुत लंबा पैराग्राफ है जो कई पंक्तियों में लपेटा जाएगा। '.repeat(40)}`;
    await page.evaluate((t) => {
      const q = window.__q(0);
      q.focus();
      const end = Math.max(0, q.getLength() - 1);
      q.setSelection(end, 0, 'api');
      q.insertText(end, `\n${t}`, 'user');
    }, pasteBody);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(500);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 10000 })
      .toBe(1);
    const afterUndo = await page.evaluate(() => window.__bpDiarySheet.getModel().pages[0].right);
    expect(afterUndo).toBe(before);
    expect(await clippedDiaryBoxes(page)).toEqual([]);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(500);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 10000 })
      .toBeGreaterThan(1);
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });

  test('undo restores left-column spill', async ({ page }) => {
    const lines = Array.from({ length: 80 }, (_, i) => `left-line-${i + 1}`).join('\n');
    await page.evaluate(() => {
      window.__bpDiarySheet.setModel({
        pages: [{
          hasHeader: true,
          header: {
            fir_number: '', thana: '', district: '', case_diary_no: '',
            rule_no: '', against_1: '', against_2: '', special_report_no: '',
            fir_date: '', event_date_place: '', sections: '', investigation_record: '',
          },
          left: 'seed',
          right: '',
        }],
      });
    });
    await page.waitForTimeout(200);

    await setLeftColumnText(page, 0, lines);
    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await expect.poll(async () => clippedDiaryBoxes(page), { timeout: 10000 }).toEqual([]);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(500);

    await expect.poll(async () => page.locator('.diary-page').count(), { timeout: 10000 })
      .toBe(1);
    const left = await page.evaluate(() => window.__bpDiarySheet.getModel().pages[0].left);
    expect(left).toBe('seed');
    expect(await clippedDiaryBoxes(page)).toEqual([]);
  });
});
