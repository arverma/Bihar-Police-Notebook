/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  sanitizeQuillHtml,
  contentToPrintHtml,
  quillPrintCssFragment,
} from './quill-fields.js';

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
