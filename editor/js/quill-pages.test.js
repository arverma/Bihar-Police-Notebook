/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  sanitizeQuillHtml,
  htmlForQuillPaste,
  contentToPrintHtml,
  quillPrintCssFragment,
  getQuillHtml,
  getQuillHtmlPreservingBlanks,
  stripHtmlToPlain,
  caretIndexAfterTextChange,
} from './quill-pages.js';

test('sanitizeQuillHtml converts U+00A0 and &nbsp; to normal spaces in rich HTML', () => {
  const html = '<p>hello&nbsp;world\u00a0there</p>';
  const out = sanitizeQuillHtml(html);
  expect(out).not.toMatch(/\u00a0/);
  expect(out).not.toMatch(/&nbsp;/i);
  expect(out).toContain('hello world there');
});

test('sanitizeQuillHtml converts nbsp in plain text', () => {
  const out = sanitizeQuillHtml('a\u00a0b&nbsp;c');
  expect(out).toBe('a b c');
});

test('sanitizeQuillHtml preserves justify and bold', () => {
  const html = '<p class="ql-align-justify"><strong>बोलता</strong> रहा</p>';
  const out = sanitizeQuillHtml(html);
  expect(out).toMatch(/ql-align-justify/);
  expect(out).toMatch(/<strong>/);
  expect(out).toContain('बोलता');
});

test('sanitizeQuillHtml strips disallowed tags but keeps text', () => {
  const out = sanitizeQuillHtml('<p>x<script>alert(1)</script>y</p>');
  expect(out).not.toMatch(/script/i);
  expect(out).toContain('x');
  expect(out).toContain('y');
});

test('sanitizeQuillHtml keeps allowlisted images with data URLs', () => {
  const out = sanitizeQuillHtml('<p><img src="data:image/png;base64,abc" alt="a" onclick="x"></p>');
  expect(out).toMatch(/src="data:image\/png;base64,abc"/);
  expect(out).not.toMatch(/onclick/);
});

test('contentToPrintHtml escapes plain text', () => {
  expect(contentToPrintHtml('a & "c" <3')).toBe('a &amp; &quot;c&quot; &lt;3');
});

test('contentToPrintHtml treats bare tags as rich and sanitizes', () => {
  const out = contentToPrintHtml('a<b>&"c');
  expect(out).toMatch(/&amp;/);
  expect(out).not.toMatch(/<script/i);
});

test('contentToPrintHtml sanitizes rich HTML and drops nbsp', () => {
  const out = contentToPrintHtml('<p>foo&nbsp;bar</p>');
  expect(out).toContain('foo bar');
  expect(out).not.toMatch(/&nbsp;/i);
});

test('quillPrintCssFragment uses pre-wrap and tab-size like live Quill', () => {
  const css = quillPrintCssFragment();
  expect(css).toMatch(/white-space:\s*pre-wrap/);
  expect(css).toMatch(/tab-size:\s*4/);
});

test('htmlForQuillPaste encodes text-node spaces as nbsp', () => {
  const out = htmlForQuillPaste('<p>   center  word</p>');
  expect(out).toMatch(/&nbsp;|&#160;|\u00a0/);
  expect(out).not.toMatch(/>\s{2,}/);
  expect(out).toContain('center');
});

test('htmlForQuillPaste does not alter img src attributes', () => {
  const html = '<p><img src="data:image/png;base64,abc" alt="a"></p>';
  const out = htmlForQuillPaste(html);
  expect(out).toMatch(/src="data:image\/png;base64,abc"/);
});

test('sanitize after htmlForQuillPaste keeps no nbsp and preserves spaces', () => {
  const stored = sanitizeQuillHtml('<p>   सेंटर  word</p>');
  const roundTrip = sanitizeQuillHtml(htmlForQuillPaste(stored));
  expect(roundTrip).not.toMatch(/\u00a0/);
  expect(roundTrip).not.toMatch(/&nbsp;/i);
  expect(roundTrip).toContain('   सेंटर  word');
});

test('sanitizeQuillHtml keeps runs of empty paragraphs for reflow', () => {
  const blanks = '<p></p>'.repeat(6);
  const out = sanitizeQuillHtml(blanks);
  expect(out).toContain('<p>');
  expect((out.match(/<p>/gi) || []).length).toBe(6);
  // Canonical empty blocks must carry <br> so static/print clones keep height.
  expect((out.match(/<br\s*\/?\s*>/gi) || []).length).toBe(6);
  expect(stripHtmlToPlain(out).trim()).toBe('');
});

test('sanitizeQuillHtml inserts br into empty P and strips ql-cursor', () => {
  const out = sanitizeQuillHtml('<p></p><p>x</p><p><span class="ql-cursor"></span></p>');
  expect(out).toMatch(/<p><br\s*\/?\s*><\/p>/i);
  expect(out).toContain('<p>x</p>');
  expect(out).not.toMatch(/ql-cursor/);
  expect((out.match(/<br\s*\/?\s*>/gi) || []).length).toBeGreaterThanOrEqual(2);
});

test('getQuillHtml collapses blank-only editors; preserving path does not', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  // Minimal Quill stand-in: getText empty, semantic HTML is blank paragraphs.
  const blanks = '<p><br></p><p><br></p><p><br></p>';
  const quill = {
    getText: () => '\n\n\n',
    root: { innerHTML: blanks, querySelector: () => null },
    getSemanticHTML: () => blanks,
  };
  expect(getQuillHtml(quill)).toBe('');
  const kept = getQuillHtmlPreservingBlanks(quill);
  expect(kept).toMatch(/<p>/i);
  expect((kept.match(/<p>/gi) || []).length).toBeGreaterThanOrEqual(3);
  document.body.removeChild(host);
});

test('getQuillHtmlPreservingBlanks uses live innerHTML, not getSemanticHTML', () => {
  const live = '<p><br></p><p><br></p>';
  const quill = {
    getText: () => '\n\n',
    root: { innerHTML: live, querySelector: () => null },
    // Semantic HTML drops <br> (Break blot length 0) — must not win.
    getSemanticHTML: () => '<p></p><p></p>',
  };
  const kept = getQuillHtmlPreservingBlanks(quill);
  expect(kept).toMatch(/<br/i);
  expect((kept.match(/<br\s*\/?\s*>/gi) || []).length).toBe(2);
  expect(kept).not.toBe('<p></p><p></p>');
});

test('caretIndexAfterTextChange lands at the end of the change', () => {
  const quill = {
    getSelection: () => ({ index: 5, length: 0 }),
    getLength: () => 12,
  };
  expect(caretIndexAfterTextChange(quill, { ops: [{ retain: 5 }, { insert: '\n' }] })).toBe(6);
  expect(caretIndexAfterTextChange(quill, { ops: [{ retain: 5 }, { insert: 'ab' }] })).toBe(7);
  expect(caretIndexAfterTextChange(quill, { ops: [{ retain: 5 }, { delete: 1 }] })).toBe(5);
});

test('caretIndexAfterTextChange ignores the selection Quill reports', () => {
  // Regression: this used to start from quill.getSelection() and then add the
  // inserted length again. Quill has already moved the selection past a user
  // insert, so every keystroke placed the caret one character too far right,
  // and each reflow used that offset. Typing "X" at index 0 reported 2.
  const afterTypingX = {
    getSelection: () => ({ index: 1, length: 0 }), // already past the insert
    getLength: () => 89,
  };
  expect(caretIndexAfterTextChange(afterTypingX, { ops: [{ insert: 'X' }] })).toBe(1);

  // A stale selection must not drag the answer either — the delta decides.
  const staleSelection = {
    getSelection: () => ({ index: 40, length: 0 }),
    getLength: () => 89,
  };
  expect(caretIndexAfterTextChange(staleSelection, { ops: [{ retain: 3 }, { insert: 'ab' }] })).toBe(5);
});

test('caretIndexAfterTextChange handles replace, embeds and formatting', () => {
  const quill = { getSelection: () => ({ index: 7, length: 0 }), getLength: () => 40 };

  // Replace: retain, delete, insert — caret sits after the inserted text.
  expect(caretIndexAfterTextChange(quill, {
    ops: [{ retain: 5 }, { delete: 3 }, { insert: 'ab' }],
  })).toBe(7);

  // Embeds count as one character.
  expect(caretIndexAfterTextChange(quill, {
    ops: [{ retain: 2 }, { insert: { image: 'x' } }],
  })).toBe(3);

  // Formatting-only: nothing moved, so the caret stays where it is.
  expect(caretIndexAfterTextChange(quill, {
    ops: [{ retain: 2 }, { retain: 3, attributes: { bold: true } }],
  })).toBe(7);

  // Never past the end of the document.
  expect(caretIndexAfterTextChange(
    { getSelection: () => null, getLength: () => 4 },
    { ops: [{ retain: 99 }, { insert: 'zz' }] },
  )).toBe(3);
});
