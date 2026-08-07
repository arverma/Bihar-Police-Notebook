/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  printCloneExtraCss,
  printCloneStylesheetLinks,
  sanitizePageClone,
} from './print-clone.js';

test('printCloneExtraCss uses zero @page margin (padding is on page cards)', () => {
  const css = printCloneExtraCss();
  expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/s);
  expect(css).toMatch(/page-break-after:\s*always/);
});

test('printCloneStylesheetLinks loads Quill snow after app CSS', () => {
  const html = printCloneStylesheetLinks();
  const styleIdx = html.indexOf('css/style.css');
  const quillIdx = html.indexOf('quill.snow.css');
  expect(styleIdx).toBeGreaterThan(-1);
  expect(quillIdx).toBeGreaterThan(styleIdx);
});

test('sanitizePageClone removes screen chrome and locks left textarea', () => {
  const page = document.createElement('div');
  page.className = 'diary-page';
  page.innerHTML = `
    <div class="diary-page-chrome screen-only"><span>Page 1</span></div>
    <div class="diary-page-header">
      <input class="diary-dotted" data-field="thana" value="पटना">
      <span class="diary-dotted diary-dotted-flow" contenteditable="true" data-field="sections">302</span>
    </div>
    <div class="diary-cell">
      <textarea class="fir-input" data-col="left" placeholder="x">left text</textarea>
    </div>
    <div class="diary-cell">
      <div class="fir-input ql-container bp-ql-container">
        <div class="ql-editor bp-ql-editor" contenteditable="true"><p>right text</p></div>
      </div>
    </div>
  `;

  sanitizePageClone(page);

  expect(page.querySelector('.screen-only')).toBeNull();
  expect(page.querySelector('.diary-page-chrome')).toBeNull();
  expect(page.querySelector('input')).toBeNull();
  expect(page.querySelector('[contenteditable]')).toBeNull();
  expect(page.querySelector('[data-field="thana"]')?.textContent).toBe('पटना');
  expect(page.querySelector('[data-field="sections"]')?.textContent).toBe('302');
  expect(page.querySelector('[data-field="sections"]')?.classList.contains('print-static')).toBe(true);

  const ta = page.querySelector('textarea[data-col="left"]');
  expect(ta).toBeTruthy();
  expect(ta.readOnly).toBe(true);
  expect(ta.getAttribute('placeholder')).toBeNull();

  expect(page.querySelector('.print-static-quill-host')).toBeTruthy();
  const body = page.querySelector('.print-static-quill');
  expect(body).toBeTruthy();
  expect(body.innerHTML).toContain('right text');
  expect(body.querySelector('p')?.textContent).toBe('right text');
});

test('sanitizePageClone preserves Quill paragraphs and align classes', () => {
  const page = document.createElement('div');
  page.className = 'diary-page';
  page.innerHTML = `
    <div class="diary-page-header">
      <span class="diary-dotted diary-dotted-flow" contenteditable="true" data-field="event_date_place">स्थान</span>
    </div>
    <div class="diary-cell">
      <div class="fir-input ql-container bp-ql-container">
        <div class="ql-editor bp-ql-editor" contenteditable="true">
          <p>चार</p>
          <p class="ql-align-center">सेंटर</p>
          <p class="ql-align-right">राइट</p>
          <p class="ql-align-justify">जस्टिफाई</p>
        </div>
      </div>
    </div>
  `;

  sanitizePageClone(page);

  const paras = page.querySelectorAll('.print-static-quill p');
  expect(paras).toHaveLength(4);
  expect(paras[0].textContent).toBe('चार');
  expect(paras[0].className).not.toMatch(/ql-align-/);
  expect(paras[1].classList.contains('ql-align-center')).toBe(true);
  expect(paras[1].textContent).toBe('सेंटर');
  expect(paras[2].classList.contains('ql-align-right')).toBe(true);
  expect(paras[2].textContent).toBe('राइट');
  expect(paras[3].classList.contains('ql-align-justify')).toBe(true);
  expect(paras[3].textContent).toBe('जस्टिफाई');

  // Must not collapse to a single text span
  expect(page.querySelector('.print-static-quill')?.childElementCount).toBe(4);

  const flow = page.querySelector('[data-field="event_date_place"]');
  expect(flow?.classList.contains('print-static')).toBe(true);
  expect(flow?.textContent).toBe('स्थान');
  expect(page.querySelector('[contenteditable]')).toBeNull();
});

test('sanitizePageClone formats date inputs as dd/mm/yyyy', () => {
  const page = document.createElement('div');
  page.className = 'diary-page';
  page.innerHTML = `<input class="diary-dotted" data-field="fir_date" type="date" value="2026-08-04">`;
  sanitizePageClone(page);
  expect(page.querySelector('[data-field="fir_date"]')?.textContent).toBe('04/08/2026');
});
