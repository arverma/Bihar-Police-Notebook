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

test('printDocumentStylesheetLinks loads the same editor stylesheets as the app', () => {
  const html = printDocumentStylesheetLinks();
  const appIdx = html.indexOf('css/editor.css');
  const docIdx = html.indexOf('css/doc-editor.css');
  expect(appIdx).toBeGreaterThan(-1);
  expect(docIdx).toBeGreaterThan(appIdx);
});

test('printDocumentExtraCss hides the screen-only page footer (raster PDF renders screen media)', () => {
  expect(printDocumentExtraCss()).toMatch(/\.print-pages \.bp-page::after\s*\{[^}]*content:\s*none/s);
});

/** A cloned diary page as the editor renders it. */
function diaryPageFixture(rightHtml) {
  const page = document.createElement('section');
  page.className = 'diary-page bp-page';
  page.innerHTML = `
    <div class="diary-page-chrome screen-only" contenteditable="false"><button class="diary-header-toggle">Hide header</button></div>
    <div class="diary-page-header" contenteditable="false">
      <input class="diary-dotted" data-field="thana" value="कोतवाली">
      <span class="diary-dotted diary-dotted-flow" contenteditable="true" data-field="event_date_place">स्थान</span>
    </div>
    <table class="fir-table"><tbody><tr class="diary-body-row">
      <td class="bp-cell-host left-column"><div class="diary-cell"><div class="bp-cell fir-input" data-col="left"><p class="is-empty" data-placeholder="यहाँ विवरण लिखें..."><br class="ProseMirror-trailingBreak"></p></div></div></td>
      <td class="bp-cell-host right-column"><div class="diary-cell"><div class="bp-cell fir-input" data-col="right" data-overflow="true">${rightHtml}</div></div></td>
    </tr></tbody></table>`;
  return page;
}

test('sanitizeExportPage removes screen chrome, editor state and controls', () => {
  const page = diaryPageFixture('<p>right text</p>');
  sanitizeExportPage(page);
  expect(page.querySelector('.screen-only')).toBeNull();
  expect(page.querySelector('.diary-page-chrome')).toBeNull();
  expect(page.querySelector('[data-placeholder]')).toBeNull();
  expect(page.querySelector('.is-empty')).toBeNull();
  expect(page.querySelector('[data-overflow]')).toBeNull();
  expect(page.querySelector('[contenteditable]')).toBeNull();
  expect(page.querySelector('input')).toBeNull();
  expect(page.querySelector('[data-field="thana"]')?.textContent).toBe('कोतवाली');
  const flow = page.querySelector('[data-field="event_date_place"]');
  expect(flow?.classList.contains('print-static')).toBe(true);
  expect(flow?.textContent).toBe('स्थान');
  // Blank lines keep their <br> so they take a line on paper too.
  expect(page.querySelector('[data-col="left"] p br')).toBeTruthy();
});

test('sanitizeExportPage keeps cell paragraphs, alignment and marks as rendered', () => {
  const page = diaryPageFixture(
    '<p>चार</p><p style="text-align: center">सेंटर</p><p style="text-align: justify"><strong>जस्टिफाई</strong></p><ol start="3"><li><p>सूची</p></li></ol>',
  );
  sanitizeExportPage(page);
  const cell = page.querySelector('[data-col="right"]');
  const paras = cell.querySelectorAll(':scope > p');
  expect(paras).toHaveLength(3);
  expect(paras[1].style.textAlign).toBe('center');
  expect(paras[2].style.textAlign).toBe('justify');
  expect(paras[2].querySelector('strong')?.textContent).toBe('जस्टिफाई');
  expect(cell.querySelector('ol')?.getAttribute('start')).toBe('3');
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
  const page = diaryPageFixture('<p>right</p>');
  page.style.setProperty('--diary-box-h', '800px');
  page.querySelector('[data-col="left"]').innerHTML = '<p>left</p>';
  pagesHost.appendChild(page);
  wrap.appendChild(pagesHost);
  document.body.appendChild(wrap);

  const built = buildPrintDocumentHtml('diary');
  expect(built?.pageCount).toBe(1);
  expect(built?.html).toContain('print-pages');
  expect(built?.html).toContain('--diary-left-col: 22%');
  expect(built?.html).toContain('--diary-box-h: 800px');
  expect(built?.html).toContain('<p>right</p>');
  expect(built?.html).toContain('<p>left</p>');
  // Typed values (not attributes) are what print.
  expect(built?.html).toContain('कोतवाली');
  wrap.remove();
});
