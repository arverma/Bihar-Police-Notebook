/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  autoDiaryFilename,
  caretColumnLength,
  caretFromGlobal,
  caretJunctionCost,
  caretToGlobal,
  collapseTrailingEmptyPages,
  columnTextLength,
  diaryFirNumber,
  emptyModel,
  isAutoDiaryFilename,
  isPageBodyEmpty,
  joinColumnContent,
  formatDiaryDocFilename,
  normalizeDiaryModel,
  quillTextLength,
  splitOverflow,
  splitTextToFit,
} from './diary-sheet.js';

const CREATED = '2026-08-01T10:00:00.000Z';

test('diaryFirNumber reads from pages header', () => {
  const model = {
    pages: [{ header: { fir_number: '  FIR-42  ' }, left: '', right: '' }],
  };
  expect(diaryFirNumber(model)).toBe('FIR-42');
  expect(diaryFirNumber(emptyModel())).toBe('');
});

test('autoDiaryFilename prefers FIR over date', () => {
  expect(autoDiaryFilename(CREATED, '')).toBe(formatDiaryDocFilename(CREATED));
  expect(autoDiaryFilename(CREATED, '123/2026')).toBe('123/2026');
});

test('isAutoDiaryFilename detects date default and FIR match', () => {
  const dateName = formatDiaryDocFilename(CREATED);
  expect(isAutoDiaryFilename(dateName, CREATED, '')).toBe(true);
  expect(isAutoDiaryFilename('123/2026', CREATED, '123/2026')).toBe(true);
  expect(isAutoDiaryFilename('My custom case', CREATED, '123/2026')).toBe(false);
});

test('normalizeDiaryModel round-trips pages[] shape', () => {
  const raw = {
    pages: [
      {
        hasHeader: true,
        header: { fir_number: '1', thana: 'A' },
        left: 'L1',
        right: '<p>R1</p>',
      },
      { hasHeader: false, left: 'L2', right: '' },
    ],
  };
  const m = normalizeDiaryModel(raw);
  expect(m.pages).toHaveLength(2);
  expect(m.pages[0].left).toBe('L1');
  expect(m.pages[0].right).toBe('<p>R1</p>');
  expect(m.pages[0].header.fir_number).toBe('1');
  expect(m.pages[1].hasHeader).toBe(false);
  expect(m.pages[1].left).toBe('L2');
});

test('normalizeDiaryModel migrates legacy flat shape', () => {
  const m = normalizeDiaryModel({
    left_box: 'old left',
    right_box: 'old right',
    fir_number: '99',
  });
  expect(m.pages).toHaveLength(1);
  expect(m.pages[0].left).toBe('old left');
  expect(m.pages[0].right).toBe('old right');
  expect(m.pages[0].header.fir_number).toBe('99');
});

test('normalizeDiaryModel accepts JSON string', () => {
  const m = normalizeDiaryModel(JSON.stringify({
    pages: [{ hasHeader: true, left: 'x', right: '' }],
  }));
  expect(m.pages[0].left).toBe('x');
});

test('splitOverflow keep always fits the box', () => {
  const ta = document.createElement('textarea');
  const boxH = 72;
  Object.defineProperty(ta, 'clientHeight', { configurable: true, get: () => boxH });
  Object.defineProperty(ta, 'scrollHeight', {
    configurable: true,
    get() {
      // ~24px per 20 chars as a crude wrap model
      const lines = Math.max(1, Math.ceil(String(ta.value || '').length / 20));
      return lines * 24;
    },
  });
  document.body.appendChild(ta);
  const full = 'x'.repeat(400);
  ta.value = full;
  expect(ta.scrollHeight).toBeGreaterThan(ta.clientHeight + 1);

  const { keep, spill } = splitOverflow(ta);
  expect(spill.length).toBeGreaterThan(0);
  expect(keep + spill).toBe(full);
  ta.value = keep;
  expect(ta.scrollHeight).toBeLessThanOrEqual(ta.clientHeight + 1);
  document.body.removeChild(ta);
});

test('splitTextToFit left spills when mirror reports overflow', () => {
  const original = HTMLTextAreaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  // Force overflow measurement inside splitTextToFit's offscreen textarea
  const clientGetter = () => 72;
  const scrollGetter = {
    get() {
      const lines = Math.max(1, Math.ceil(String(this.value || '').length / 20));
      return lines * 24;
    },
  };
  Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', {
    configurable: true,
    get: clientGetter,
  });
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    ...scrollGetter,
  });

  try {
    const long = 'अनुच्छेद '.repeat(500);
    const { keep, spill } = splitTextToFit(long, 'left', false);
    expect(spill.length).toBeGreaterThan(0);
    expect(joinColumnContent(keep, spill)).toBe(long);
    const again = splitTextToFit(keep, 'left', false);
    expect(again.spill).toBe('');
  } finally {
    if (desc) {
      Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', desc);
    } else {
      delete HTMLTextAreaElement.prototype.clientHeight;
    }
    delete HTMLTextAreaElement.prototype.scrollHeight;
  }
  void original;
});

test('joinColumnContent and columnTextLength are column-safe', () => {
  expect(joinColumnContent('a', 'b')).toBe('ab');
  expect(columnTextLength('abc', 'left')).toBe(3);
  expect(columnTextLength('<p>हिंदी</p>', 'right')).toBe('हिंदी'.length);
  expect(columnTextLength('<p>हिंदी</p>', 'left')).toBe('<p>हिंदी</p>'.length);
});

test('caretColumnLength counts block breaks like Quill indices do', () => {
  expect(caretColumnLength('abc', 'left')).toBe(3);
  expect(caretColumnLength('<p>ab</p>', 'right')).toBe(2);

  // Trailing empty paragraphs are invisible to plain text but each hold a
  // Quill index, which is what shifted the caret after a boundary Backspace.
  const withBlanks = '<p>ab</p><p><br></p><p><br></p>';
  expect(columnTextLength(withBlanks, 'right')).toBe(2);
  expect(caretColumnLength(withBlanks, 'right')).toBe(4);

  expect(quillTextLength('<p>a</p><p>b</p><p>c</p>')).toBe(5);
  expect(quillTextLength('')).toBe(0);
});

test('caret global offsets round-trip through page boundaries', () => {
  const lengths = [120, 40, 10];

  for (const col of ['left', 'right']) {
    const junction = caretJunctionCost(col);
    for (const [pageIndex, localOffset] of [[0, 0], [0, 119], [1, 17], [2, 10]]) {
      const global = caretToGlobal(lengths, junction, pageIndex, localOffset);
      expect(caretFromGlobal(lengths, junction, global)).toEqual({ pageIndex, localOffset });
    }
  }

  // Left pages are joined raw, so the end of page 1 and the start of page 2 are
  // the same caret position; it resolves to the earlier page.
  expect(caretToGlobal(lengths, 0, 1, 0)).toBe(caretToGlobal(lengths, 0, 0, 120));
  expect(caretFromGlobal(lengths, 0, 120)).toEqual({ pageIndex: 0, localOffset: 120 });

  // Right pages gain a block break at the junction, so they stay distinct.
  expect(caretFromGlobal(lengths, 1, 121)).toEqual({ pageIndex: 1, localOffset: 0 });
});

test('Backspace at start of a right-column page targets the merge point', () => {
  const junction = caretJunctionCost('right');

  // Page 1 holds "…सोएँ।" plus two blank paragraphs; page 2 holds one line.
  const page1 = '<p>वह मर जाए, तो आराम से सोएँ।</p><p><br></p><p><br></p>';
  const page2 = '<p>यही बात है</p>';
  const lengths = [caretColumnLength(page1, 'right'), caretColumnLength(page2, 'right')];

  const junctionOffset = caretToGlobal(lengths, junction, 1, 0);
  const afterDelete = junctionOffset - 1;

  // After the merge, page 1 is one character shorter and holds page 2's line.
  const mergedLen = lengths[0] - 1 + junction + lengths[1];
  const landed = caretFromGlobal([mergedLen], junction, afterDelete);
  expect(landed.pageIndex).toBe(0);
  // The merged line starts right where the caret lands.
  expect(landed.localOffset).toBe(lengths[0] - 1 + junction);
});

test('collapseTrailingEmptyPages never drops page 1 or headed pages', () => {
  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: '', right: '' },
  ])).toHaveLength(1);

  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: 'a', right: '' },
    { hasHeader: false, left: '', right: '' },
    { hasHeader: false, left: '', right: '' },
  ])).toHaveLength(1);

  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: '', right: '' },
    { hasHeader: true, left: '', right: '' },
  ])).toHaveLength(2);

  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: 'x', right: '' },
    { hasHeader: false, left: 'y', right: '' },
  ])).toHaveLength(2);

  // Blank paragraphs are content — do not collapse them away.
  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: '', right: '<p>line</p>' },
    { hasHeader: false, left: '', right: '<p><br></p><p><br></p>' },
  ])).toHaveLength(2);
});

test('isPageBodyEmpty treats blank paragraphs as occupied', () => {
  expect(isPageBodyEmpty({ left: '  ', right: '' })).toBe(true);
  expect(isPageBodyEmpty({ left: '', right: '<p><br></p>' })).toBe(true);
  expect(isPageBodyEmpty({ left: 'a', right: '' })).toBe(false);
  expect(isPageBodyEmpty({ left: '', right: '<p><br></p><p><br></p>' })).toBe(false);
  expect(isPageBodyEmpty({ left: '', right: '<p>हिंदी</p>' })).toBe(false);
});

test('collapseTrailingEmptyPages keepIndex preserves caret-owned blank page', () => {
  const pages = [
    { hasHeader: true, left: '', right: '<p>33</p>' },
    { hasHeader: false, left: '', right: '<p><br></p>' },
  ];
  // Without keepIndex, lone blank is Quill-default empty → collapsed.
  expect(collapseTrailingEmptyPages(pages)).toHaveLength(1);
  // With keepIndex=1, caret-owned spill blank page is kept.
  expect(collapseTrailingEmptyPages(pages, 1)).toHaveLength(2);
});

test('collapseTrailingEmptyPages still drops absorb leftovers when caret is on page 0', () => {
  expect(collapseTrailingEmptyPages([
    { hasHeader: true, left: '', right: '<p>kept</p>' },
    { hasHeader: false, left: '', right: '<p><br></p>' },
  ], 0)).toHaveLength(1);
});

