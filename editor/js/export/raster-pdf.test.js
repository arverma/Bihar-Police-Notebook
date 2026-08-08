/**
 * @vitest-environment jsdom
 */
import { expect, test, beforeEach } from 'vitest';
import {
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  normalizePdfFilename,
  generateRasterPdf,
  deliverPdfBlob,
  prepareCloneForRaster,
} from './raster-pdf.js';

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:mock-pdf';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => {};
  }
});

test('normalizePdfFilename appends .pdf once and strips unsafe chars', () => {
  expect(normalizePdfFilename('Diary')).toBe('Diary.pdf');
  expect(normalizePdfFilename('Diary.pdf')).toBe('Diary.pdf');
  expect(normalizePdfFilename('a/b:c*.pdf')).toBe('a b c.pdf');
  expect(normalizePdfFilename('   ')).toBe('Document.pdf');
});

test('prepareCloneForRaster swaps textareas for wrapping static boxes', () => {
  const host = document.createElement('div');
  host.innerHTML = `
    <table class="fir-table"><tbody><tr>
      <td class="left-column"><textarea class="fir-input" data-col="left"></textarea></td>
    </tr></tbody></table>
  `;
  document.body.appendChild(host);
  const ta = host.querySelector('textarea');
  ta.value = 'पहली पंक्ति\nदूसरी पंक्ति';

  try {
    prepareCloneForRaster(document);

    expect(host.querySelector('textarea')).toBeNull();
    const box = host.querySelector('.fir-input');
    expect(box.tagName).toBe('DIV');
    expect(box.textContent).toBe('पहली पंक्ति\nदूसरी पंक्ति');
    expect(box.style.whiteSpace).toBe('pre-wrap');
    expect(box.style.overflow).toBe('hidden');
    expect(box.dataset.col).toBe('left');
  } finally {
    host.remove();
  }
});

test('prepareCloneForRaster gives each table edge a single owner', () => {
  const host = document.createElement('div');
  host.innerHTML = `
    <table class="fir-table"><tbody>
      <tr><th class="left-column">a</th><th class="right-column">b</th></tr>
      <tr><td class="left-column">c</td><td class="right-column">d</td></tr>
    </tbody></table>
  `;
  document.body.appendChild(host);
  try {
    prepareCloneForRaster(document);

    const cell = (r, c) => host.querySelectorAll('tr')[r].cells[c];
    // Only the left cell draws the shared vertical edge.
    expect(cell(0, 0).style.borderRightWidth).toBe('1px');
    expect(cell(0, 1).style.borderLeftWidth).toBe('0px');
    // Only the top row draws the shared horizontal edge.
    expect(cell(0, 0).style.borderBottomWidth).toBe('1px');
    expect(cell(1, 0).style.borderTopWidth).toBe('0px');
    // Edge cells draw the frame, at the same weight as the inner rules.
    expect(cell(0, 0).style.borderTopWidth).toBe('1px');
    expect(cell(0, 0).style.borderLeftWidth).toBe('1px');
    expect(cell(1, 1).style.borderRightWidth).toBe('1px');
    expect(cell(1, 1).style.borderBottomWidth).toBe('1px');
    // A table border would sit under the opaque cell backgrounds.
    expect(host.querySelector('.fir-table').style.borderWidth).toBe('0px');
  } finally {
    host.remove();
  }
});

test('prepareCloneForRaster frames the first visible row on header-less pages', () => {
  const host = document.createElement('div');
  host.innerHTML = `
    <table class="fir-table"><tbody>
      <tr class="diary-titles-row" hidden><th>a</th><th>b</th></tr>
      <tr class="diary-body-row"><td>c</td><td>d</td></tr>
    </tbody></table>
  `;
  document.body.appendChild(host);
  try {
    prepareCloneForRaster(document);

    const body = host.querySelector('.diary-body-row');
    expect(body.cells[0].style.borderTopWidth).toBe('1px');
  } finally {
    host.remove();
  }
});

test('generateRasterPdf builds one A4 page per clone card and cleans up', async () => {
  const formats = [];
  const images = [];
  let cleaned = false;
  const pageEls = [
    document.createElement('div'),
    document.createElement('div'),
  ];
  pageEls.forEach((el, i) => {
    el.className = 'diary-page';
    el.textContent = `page-${i}`;
  });

  const fakeCanvas = {
    width: 100,
    height: 100,
    toDataURL: () => 'data:image/jpeg;base64,AAA',
    getContext: () => ({ clearRect() {} }),
  };

  const result = await generateRasterPdf({
    template: 'diary',
    filename: 'केस',
    title: 'केस',
    scale: 2,
    quality: 0.9,
    mount: async () => ({
      frame: /** @type {any} */ ({}),
      doc: document,
      win: window,
      pageCount: 2,
      pageEls,
      cleanup: () => { cleaned = true; },
    }),
    libs: {
      html2canvas: async (el) => {
        expect(el).toBeInstanceOf(HTMLElement);
        return /** @type {any} */ (fakeCanvas);
      },
      jsPDF: class {
        constructor(opts) {
          formats.push(opts.format);
          this.internal = {
            pageSize: {
              getWidth: () => A4_WIDTH_PT,
              getHeight: () => A4_HEIGHT_PT,
            },
          };
          this.props = null;
        }
        setProperties(p) { this.props = p; }
        addPage(format) { formats.push(format); }
        addImage(data, type, x, y, w, h) {
          images.push({ data, type, x, y, w, h });
        }
        output(type) {
          expect(type).toBe('blob');
          return new Blob(['%PDF-1.4'], { type: 'application/pdf' });
        }
      },
    },
  });

  expect(cleaned).toBe(true);
  expect(result.filename).toBe('केस.pdf');
  expect(result.pageCount).toBe(2);
  expect(result.blob.type).toBe('application/pdf');
  expect(formats).toEqual([
    [A4_WIDTH_PT, A4_HEIGHT_PT],
    [A4_WIDTH_PT, A4_HEIGHT_PT],
  ]);
  expect(images).toHaveLength(2);
  expect(images[0].w).toBe(A4_WIDTH_PT);
  expect(images[0].h).toBe(A4_HEIGHT_PT);
  expect(images[0].type).toBe('JPEG');
});

test('generateRasterPdf throws empty and still cleans up when no pages', async () => {
  let cleaned = false;
  await expect(generateRasterPdf({
    template: 'letter',
    filename: 'x',
    mount: async () => ({
      frame: /** @type {any} */ ({}),
      doc: document,
      win: window,
      pageCount: 0,
      pageEls: [],
      cleanup: () => { cleaned = true; },
    }),
    libs: {
      html2canvas: async () => /** @type {any} */ ({
        width: 1,
        height: 1,
        toDataURL: () => 'data:image/jpeg;base64,AA',
        getContext: () => ({ clearRect() {} }),
      }),
      jsPDF: class {
        constructor() {
          this.internal = {
            pageSize: { getWidth: () => A4_WIDTH_PT, getHeight: () => A4_HEIGHT_PT },
          };
        }
        setProperties() {}
        addPage() {}
        addImage() {}
        output() { return new Blob(); }
      },
    },
  })).rejects.toThrow('empty');
  expect(cleaned).toBe(true);
});

test('deliverPdfBlob prefers the native share sheet when files are shareable', async () => {
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const shared = [];
  navigator.canShare = () => true;
  navigator.share = async (data) => { shared.push(data); };
  try {
    const mode = await deliverPdfBlob(blob, 'Doc.pdf', { revokeDelayMs: 1 });
    expect(mode).toBe('share');
    expect(shared[0].files[0].name).toBe('Doc.pdf');
  } finally {
    delete navigator.canShare;
    delete navigator.share;
  }
});

test('deliverPdfBlob uses preview window when share is unavailable', async () => {
  const preview = { closed: false, location: { href: '' } };
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const mode = await deliverPdfBlob(blob, 'Doc.pdf', {
    previewWindow: preview,
    revokeDelayMs: 1,
    share: false,
  });
  expect(mode).toBe('preview');
  expect(preview.location.href).toMatch(/^blob:/);
});

test('deliverPdfBlob shows a tap-to-save sheet on iOS browsers', async () => {
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const origUa = navigator.userAgent;
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
    configurable: true,
  });
  try {
    const pending = deliverPdfBlob(blob, 'Doc.pdf', { revokeDelayMs: 1, share: false });
    const link = document.querySelector('.bp-pdf-ready-overlay a');
    expect(link).toBeTruthy();
    expect(link.getAttribute('download')).toBe('Doc.pdf');
    expect(link.getAttribute('href')).toMatch(/^blob:/);

    document.querySelector('.bp-pdf-ready-overlay button').click();
    await pending;
    expect(document.querySelector('.bp-pdf-ready-overlay')).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'userAgent', { value: origUa, configurable: true });
  }
});

test('deliverPdfBlob falls back to download anchor', async () => {
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const clicks = [];
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === 'a') {
      el.click = () => clicks.push(el.download);
    }
    return el;
  };
  try {
    const mode = await deliverPdfBlob(blob, 'Doc.pdf', {
      previewWindow: null,
      revokeDelayMs: 1,
      share: false,
    });
    expect(mode).toBe('download');
    expect(clicks).toEqual(['Doc.pdf']);
  } finally {
    document.createElement = origCreate;
  }
});

test('deliverPdfBlob never opens a blank tab before generation', async () => {
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  let opened = 0;
  const origOpen = window.open;
  window.open = () => { opened += 1; return null; };
  try {
    await deliverPdfBlob(blob, 'Doc.pdf', { revokeDelayMs: 1, share: false });
    expect(opened).toBe(0);
  } finally {
    window.open = origOpen;
  }
});
