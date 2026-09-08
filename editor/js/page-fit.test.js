/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  measureRichFits,
  peelLastContentUnit,
  peelLastPlainLine,
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
