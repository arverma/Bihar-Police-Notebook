/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  joinRightSpillOntoNext,
  measureRichFits,
  peelLastContentUnit,
  peelLastPlainLine,
  prependPeeledBlock,
  splitBlockTextToFit,
  splitRichToFitStatic,
  takeFirstContentUnit,
  takeFirstPlainLine,
  takeFittingHtmlPrefix,
} from './page-fit.js';

function mockProbeHeights(clientH, scrollForContent) {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('page-fit-probe')) return clientH;
      return desc?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('page-fit-probe')) {
        return scrollForContent(this);
      }
      return 0;
    },
  });
  return () => {
    if (desc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', desc);
    else delete HTMLElement.prototype.clientHeight;
    delete HTMLElement.prototype.scrollHeight;
  };
}

test('measureRichFits reports overflow for tall plain text', () => {
  const restore = mockProbeHeights(48, (el) => {
    const lines = Math.max(1, String(el.textContent || '').split('\n').length);
    return lines * 24;
  });
  try {
    const tall = `${'line\n'.repeat(80)}`;
    expect(measureRichFits(tall, 200, 48, { fontSize: 16, lineHeight: 24, padding: '0' })).toBe(false);
    expect(measureRichFits('short', 200, 48, { fontSize: 16, lineHeight: 24, padding: '0' })).toBe(true);
  } finally {
    restore();
  }
});

test('splitRichToFitStatic spills plain overflow and reunites', () => {
  const restore = mockProbeHeights(72, (el) => {
    const len = String(el.textContent || '').length;
    return Math.max(24, Math.ceil(len / 20) * 24);
  });
  try {
    const tall = `${'अनुच्छेद '.repeat(40)}\n`.repeat(30);
    const { keep, spill } = splitRichToFitStatic(tall, 200, 72, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(spill.length).toBeGreaterThan(0);
    expect(keep + spill).toBe(tall);
    expect(measureRichFits(keep, 200, 72, { fontSize: 16, lineHeight: 24, padding: '0' })).toBe(true);
  } finally {
    restore();
  }
});

test('splitRichToFitStatic spills HTML by blocks', () => {
  const restore = mockProbeHeights(96, (el) => {
    const n = el.querySelectorAll('p').length || 1;
    return n * 24;
  });
  try {
    const html = Array.from({ length: 40 }, () => '<p>यह एक लंबा वाक्य है।</p>').join('');
    const { keep, spill } = splitRichToFitStatic(html, 400, 96, {
      fontSize: 16,
      lineHeight: 24,
      padding: '4px',
    });
    expect(spill.length).toBeGreaterThan(0);
    expect(keep).toMatch(/<p>/i);
    expect(spill).toMatch(/<p>/i);
  } finally {
    restore();
  }
});

test('takeFirstContentUnit and peelLastContentUnit for plain and HTML', () => {
  expect(takeFirstPlainLine('a\nb\n')).toEqual({ unit: 'a\n', rest: 'b\n' });
  expect(peelLastPlainLine('a\nb\n')).toEqual({ keep: 'a\n', peeled: 'b\n' });
  expect(takeFirstContentUnit('<p>one</p><p>two</p>')).toEqual({
    unit: '<p>one</p>',
    rest: '<p>two</p>',
  });
  expect(peelLastContentUnit('<p>one</p><p>two</p>')).toEqual({
    keep: '<p>one</p>',
    peeled: '<p>two</p>',
  });
});

test('splitRichToFitStatic keeps a non-empty prefix of an overflowing paragraph', () => {
  const restore = mockProbeHeights(48, (el) => {
    const len = String(el.textContent || '').replace(/\s+/g, ' ').trim().length;
    return Math.max(24, Math.ceil(Math.max(1, len) / 12) * 24);
  });
  try {
    const long = `${'अनुच्छेद '.repeat(80)}`.trim();
    const html = `<p class="ql-align-justify">${long}</p>`;
    const { keep, spill } = splitRichToFitStatic(html, 200, 48, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(spill.length).toBeGreaterThan(0);
    expect(keep).toMatch(/<p[^>]*class="[^"]*ql-align-justify/);
    expect(spill).toMatch(/<p[^>]*class="[^"]*ql-align-justify/);
    const keepText = keep.replace(/<[^>]+>/g, '');
    const spillText = spill.replace(/<[^>]+>/g, '');
    expect(keepText.length).toBeGreaterThan(0);
    expect(keepText + spillText).toBe(long);
    expect(measureRichFits(keep, 200, 48, { fontSize: 16, lineHeight: 24, padding: '0' })).toBe(true);
  } finally {
    restore();
  }
});

test('splitBlockTextToFit preserves align and reunites text', () => {
  const restore = mockProbeHeights(48, (el) => {
    const len = String(el.textContent || '').length;
    return Math.max(24, Math.ceil(Math.max(1, len) / 10) * 24);
  });
  try {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const block = `<p class="ql-align-center">${text}</p>`;
    const { keepBlockHtml, spillBlockHtml } = splitBlockTextToFit('', block, 200, 48, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(keepBlockHtml).toMatch(/ql-align-center/);
    expect(spillBlockHtml).toMatch(/ql-align-center/);
    const reunited = (keepBlockHtml + spillBlockHtml).replace(/<[^>]+>/g, '');
    expect(reunited).toBe(text);
  } finally {
    restore();
  }
});

test('peelLastContentUnit peels a trailing word from a long paragraph', () => {
  const { keep, peeled } = peelLastContentUnit('<p>one two three</p>');
  expect(keep).toBe('<p>one two </p>');
  expect(peeled).toBe('<p>three</p>');
});

test('prependPeeledBlock merges same-align one-word peels into one paragraph', () => {
  // Live peel sheds the last word first, then prepends onto the spill accumulator.
  let spill = '';
  for (const word of ['theta', 'eta ', 'zeta ']) {
    spill = prependPeeledBlock(`<p class="ql-align-justify">${word}</p>`, spill);
  }
  expect((spill.match(/<p\b/gi) || []).length).toBe(1);
  expect(spill).toMatch(/ql-align-justify/);
  expect(spill.replace(/<[^>]+>/g, '')).toBe('zeta eta theta');
});

test('prependPeeledBlock merges center-aligned peels the same way', () => {
  const spill = prependPeeledBlock(
    '<p class="ql-align-center">alpha </p>',
    '<p class="ql-align-center">beta gamma</p>',
  );
  expect(spill).toBe('<p class="ql-align-center">alpha beta gamma</p>');
});

test('prependPeeledBlock concatenates when align differs', () => {
  const out = prependPeeledBlock(
    '<p class="ql-align-justify">word </p>',
    '<p class="ql-align-center">rest</p>',
  );
  expect(out).toBe(
    '<p class="ql-align-justify">word </p><p class="ql-align-center">rest</p>',
  );
});

test('prependPeeledBlock merges past a single leading blank into the text block', () => {
  const out = prependPeeledBlock(
    '<p class="ql-align-justify">word </p>',
    '<p class="ql-align-justify"><br></p><p class="ql-align-justify">rest</p>',
  );
  expect(out).toBe(
    '<p class="ql-align-justify"><br></p><p class="ql-align-justify">word rest</p>',
  );
});

test('prependPeeledBlock merges into first text block after leading Enter blanks', () => {
  // Enter near a page edge often spills `<p><br></p>` ahead of the continuation.
  // Live peel must still rejoin words into that continuation, not stack one-word
  // <p>s in front of the blanks (gaps / sparse lines on page 2).
  let spill = '<p class="ql-align-right"><br></p><p class="ql-align-right"><br></p>'
    + '<p class="ql-align-right">rest of the paragraph here</p>';
  spill = prependPeeledBlock(
    '<p class="ql-align-right">word </p>',
    spill,
  );
  expect(spill).toBe(
    '<p class="ql-align-right"><br></p><p class="ql-align-right"><br></p>'
    + '<p class="ql-align-right">word rest of the paragraph here</p>',
  );
  // Multiple peels must keep collapsing into the same text block.
  spill = prependPeeledBlock('<p class="ql-align-right">more </p>', spill);
  expect((spill.match(/<p\b/gi) || []).length).toBe(3); // 2 blanks + 1 text
  expect(spill.replace(/<[^>]+>/g, '')).toBe('more word rest of the paragraph here');
});

test('prependPeeledBlock returns peeled when spill is empty', () => {
  expect(prependPeeledBlock('<p class="ql-align-right">solo</p>', ''))
    .toBe('<p class="ql-align-right">solo</p>');
});

test('joinRightSpillOntoNext merges adjacent same-align halves', () => {
  const out = joinRightSpillOntoNext(
    '<p class="ql-align-right">short </p>',
    '<p class="ql-align-right">long continuation</p>',
  );
  expect(out).toBe('<p class="ql-align-right">short long continuation</p>');
});

test('joinRightSpillOntoNext strips one trailing blank on spill before merge', () => {
  const out = joinRightSpillOntoNext(
    '<p><br></p><p class="ql-align-right">short </p><p><br></p>',
    '<p class="ql-align-right">long continuation</p><p><br></p>',
  );
  expect(out).toBe(
    '<p><br></p><p class="ql-align-right">short long continuation</p><p><br></p>',
  );
});

test('joinRightSpillOntoNext refuses merge when two trailing blanks on spill', () => {
  const spill = '<p class="ql-align-justify">a </p><p><br></p><p><br></p>';
  const next = '<p class="ql-align-justify">b</p>';
  expect(joinRightSpillOntoNext(spill, next)).toBe(spill + next);
});

test('joinRightSpillOntoNext concatenates when align differs', () => {
  const out = joinRightSpillOntoNext(
    '<p class="ql-align-right">a </p>',
    '<p class="ql-align-justify">b</p>',
  );
  expect(out).toBe(
    '<p class="ql-align-right">a </p><p class="ql-align-justify">b</p>',
  );
});

test('joinRightSpillOntoNext does not weld unaligned separate paragraphs', () => {
  // Enter-spill of numbered lines: both <p> share an empty align key.
  const out = joinRightSpillOntoNext('<p>29</p>', '<p>30</p><p>31</p>');
  expect(out).toBe('<p>29</p><p>30</p><p>31</p>');
});

test('joinRightSpillOntoNext returns spill when next is empty', () => {
  expect(joinRightSpillOntoNext('<p class="ql-align-center">only</p>', ''))
    .toBe('<p class="ql-align-center">only</p>');
});

test('takeFittingHtmlPrefix moves a fitting text prefix into slack', () => {
  const restore = mockProbeHeights(72, (el) => {
    const len = String(el.textContent || '').length;
    return Math.max(24, Math.ceil(Math.max(1, len) / 10) * 24);
  });
  try {
    const prev = '<p>short</p>';
    const later = `<p>${'word '.repeat(60).trim()}</p>`;
    const { nextPrev, rest } = takeFittingHtmlPrefix(prev, later, 200, 72, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(nextPrev.length).toBeGreaterThan(prev.length);
    expect(rest.length).toBeGreaterThan(0);
    expect(measureRichFits(nextPrev, 200, 72, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    })).toBe(true);
    const plain = (s) => s.replace(/<[^>]+>/g, '');
    expect(plain(nextPrev) + plain(rest)).toBe(plain(prev) + plain(later));
  } finally {
    restore();
  }
});

test('takeFittingHtmlPrefix never welds a separate paragraph onto a partial line', () => {
  // One line per block, 10 chars per line. Box holds 2 lines and prev already
  // uses both, so no further block fits — but "29" leaves width free on its
  // line, which absorb used to fill with the next paragraph ("29" + "30").
  const restore = mockProbeHeights(48, (el) => {
    const blocks = [...el.children];
    if (!blocks.length) return 24;
    return blocks.reduce(
      (n, b) => n + Math.max(1, Math.ceil((b.textContent || '').length / 10)),
      0,
    ) * 24;
  });
  try {
    const prev = '<p>aaa</p><p>29</p>';
    const { nextPrev, rest } = takeFittingHtmlPrefix(prev, '<p>30</p>', 200, 48, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(nextPrev).toBe(prev);
    expect(rest).toBe('<p>30</p>');
  } finally {
    restore();
  }
});

test('takeFittingHtmlPrefix merges into last paragraph to use leftover line width', () => {
  // Height fits ~2 lines of 10 chars; prev is one full line so a new <p> would
  // need a third line, but merging into the last <p> can still add characters.
  const restore = mockProbeHeights(48, (el) => {
    const len = String(el.textContent || '').length;
    return Math.max(24, Math.ceil(Math.max(1, len) / 10) * 24);
  });
  try {
    const prev = `<p>${'aaaaaaaaaa'}</p>`; // 10 chars = 1 line
    const later = `<p>${'bbbbbbbbbb cccccccccc dddddddddd'}</p>`;
    const { nextPrev, rest } = takeFittingHtmlPrefix(prev, later, 200, 48, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    });
    expect(nextPrev).toMatch(/^<p>aaaaaaaaaa/);
    expect(nextPrev.replace(/<[^>]+>/g, '').startsWith('aaaaaaaaaa')).toBe(true);
    expect(nextPrev.replace(/<[^>]+>/g, '').length).toBeGreaterThan(10);
    // Must be a single merged paragraph, not prev + new block.
    expect((nextPrev.match(/<p/gi) || []).length).toBe(1);
    expect(rest.length).toBeGreaterThan(0);
    expect(measureRichFits(nextPrev, 200, 48, {
      fontSize: 16,
      lineHeight: 24,
      padding: '0',
    })).toBe(true);
  } finally {
    restore();
  }
});
