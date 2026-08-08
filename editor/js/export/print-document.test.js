/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  printDocumentExtraCss,
  printDocumentStylesheetLinks,
  sanitizeExportPage,
} from './print-document.js';

test('printDocumentExtraCss uses zero @page margin (padding is on page cards)', () => {
  const css = printDocumentExtraCss();
  expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/s);
  expect(css).toMatch(/page-break-after:\s*always/);
});

test('printDocumentExtraCss disables WebKit font boosting', () => {
  const css = printDocumentExtraCss();
  expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/);
  expect(css).toMatch(/[^-]text-size-adjust:\s*100%/);
});

test('printDocumentExtraCss keeps the titles-row field on its own line', () => {
  const css = printDocumentExtraCss();
  expect(css).toMatch(
    /\.print-pages \.fir-table th\.right-column \.print-static\s*\{[^}]*display:\s*block/s,
  );
});

test('printDocumentStylesheetLinks loads Quill snow after app CSS', () => {
  const html = printDocumentStylesheetLinks();
  const styleIdx = html.indexOf('css/editor.css');
  const quillIdx = html.indexOf('quill.snow.css');
  expect(styleIdx).toBeGreaterThan(-1);
  expect(quillIdx).toBeGreaterThan(styleIdx);
});

test('sanitizeExportPage removes screen chrome and locks left textarea', () => {
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

  sanitizeExportPage(page);

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

test('sanitizeExportPage preserves Quill paragraphs and align classes', () => {
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

  sanitizeExportPage(page);

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

test('sanitizeExportPage formats date inputs as dd/mm/yyyy', () => {
  const page = document.createElement('div');
  page.className = 'diary-page';
  page.innerHTML = `<input class="diary-dotted" data-field="fir_date" type="date" value="2026-08-04">`;
  sanitizeExportPage(page);
  expect(page.querySelector('[data-field="fir_date"]')?.textContent).toBe('04/08/2026');
});

test('buildPrintDocumentHtml returns null without live pages', async () => {
  const { buildPrintDocumentHtml } = await import('./print-document.js');
  expect(buildPrintDocumentHtml('diary')).toBeNull();
  expect(buildPrintDocumentHtml('letter')).toBeNull();
});

test('buildPrintDocumentHtml clones diary pages and preserves CSS vars', async () => {
  const { buildPrintDocumentHtml } = await import('./print-document.js');
  const wrap = document.createElement('div');
  wrap.className = 'editor-wrapper editor-diary';
  const pagesHost = document.createElement('div');
  pagesHost.id = 'diaryPages';
  pagesHost.style.setProperty('--diary-left-col', '22%');
  const page = document.createElement('div');
  page.className = 'diary-page';
  page.style.setProperty('--diary-box-h', '800px');
  page.innerHTML = `
    <textarea class="fir-input" data-col="left">left</textarea>
    <div class="diary-cell">
      <div class="fir-input ql-container bp-ql-container">
        <div class="ql-editor bp-ql-editor" style="width:400px;height:200px"><p>right</p></div>
      </div>
    </div>
  `;
  // Fake layout metrics for jsdom
  Object.defineProperty(page.querySelector('.ql-editor'), 'clientWidth', { value: 400 });
  Object.defineProperty(page.querySelector('.ql-editor'), 'clientHeight', { value: 200 });
  Object.defineProperty(page.querySelector('textarea'), 'clientWidth', { value: 80 });
  Object.defineProperty(page.querySelector('textarea'), 'clientHeight', { value: 200 });
  pagesHost.appendChild(page);
  wrap.appendChild(pagesHost);
  document.body.appendChild(wrap);

  const built = buildPrintDocumentHtml('diary');
  expect(built).toBeTruthy();
  expect(built?.pageCount).toBe(1);
  expect(built?.html).toContain('print-pages');
  expect(built?.html).toContain('--diary-left-col');
  expect(built?.html).toContain('right');
  expect(built?.html).toContain('left');
  wrap.remove();
});
