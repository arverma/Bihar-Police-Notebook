/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import {
  shouldUseRasterPdf,
  resolveExportMode,
  runDocumentExport,
} from './router.js';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC_SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

test('shouldUseRasterPdf detects iPhone and iPad', () => {
  expect(shouldUseRasterPdf(IPHONE_UA)).toBe(true);
  expect(shouldUseRasterPdf(IPAD_UA)).toBe(true);
});

test('shouldUseRasterPdf detects iPadOS desktop mode via touch points', () => {
  expect(shouldUseRasterPdf(IPADOS_DESKTOP_UA, {
    maxTouchPoints: 5,
    platform: 'MacIntel',
  })).toBe(true);
});

test('shouldUseRasterPdf leaves macOS Safari, Android, and desktop on native print', () => {
  expect(shouldUseRasterPdf(MAC_SAFARI_UA, {
    maxTouchPoints: 0,
    platform: 'MacIntel',
  })).toBe(false);
  expect(shouldUseRasterPdf(ANDROID_UA)).toBe(false);
  expect(shouldUseRasterPdf(DESKTOP_CHROME_UA)).toBe(false);
});

test('resolveExportMode honors explicit override', () => {
  expect(resolveExportMode({ mode: 'raster-pdf', ua: DESKTOP_CHROME_UA })).toBe('raster-pdf');
  expect(resolveExportMode({ mode: 'native-print', ua: IPHONE_UA })).toBe('native-print');
  expect(resolveExportMode({ ua: IPHONE_UA })).toBe('raster-pdf');
  expect(resolveExportMode({ ua: DESKTOP_CHROME_UA })).toBe('native-print');
});

test('runDocumentExport desktop path calls nativePrint only', async () => {
  const calls = { native: 0, raster: 0, deliver: 0 };
  const result = await runDocumentExport({
    template: 'diary',
    filename: 'Test',
    mode: 'native-print',
    nativePrint: async () => {
      calls.native += 1;
      return 'ok';
    },
    rasterPdf: async () => {
      calls.raster += 1;
      return { blob: new Blob(['%PDF']), filename: 'Test.pdf', pageCount: 1 };
    },
    deliver: () => {
      calls.deliver += 1;
      return 'download';
    },
  });
  expect(result).toBe('ok');
  expect(calls).toEqual({ native: 1, raster: 0, deliver: 0 });
});

test('runDocumentExport iOS path calls rasterPdf and deliver, not nativePrint', async () => {
  const calls = { native: 0, raster: 0, deliver: 0 };
  const order = [];
  const result = await runDocumentExport({
    template: 'diary',
    filename: 'केस दैनिकी',
    mode: 'raster-pdf',
    nativePrint: async () => {
      calls.native += 1;
      return 'ok';
    },
    rasterPdf: async (opts) => {
      calls.raster += 1;
      order.push('generate');
      expect(opts.template).toBe('diary');
      expect(opts.filename).toBe('केस दैनिकी');
      return { blob: new Blob(['%PDF-1.4']), filename: 'केस दैनिकी.pdf', pageCount: 2 };
    },
    deliver: async (blob, filename) => {
      calls.deliver += 1;
      order.push('deliver');
      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toBe('केस दैनिकी.pdf');
      return 'download';
    },
  });
  expect(result).toBe('ok');
  expect(calls).toEqual({ native: 0, raster: 1, deliver: 1 });
  // Delivery must happen after generation — never reserve a tab up front on iOS.
  expect(order).toEqual(['generate', 'deliver']);
});

test('runDocumentExport empty native path alerts and returns empty', async () => {
  const alerts = [];
  const result = await runDocumentExport({
    template: 'letter',
    mode: 'native-print',
    nativePrint: async () => 'empty',
    alert: (msg) => alerts.push(msg),
  });
  expect(result).toBe('empty');
  expect(alerts[0]).toMatch(/empty/i);
});

test('runDocumentExport raster empty alerts without delivering', async () => {
  const alerts = [];
  let delivered = 0;
  const result = await runDocumentExport({
    template: 'diary',
    mode: 'raster-pdf',
    rasterPdf: async () => {
      throw new Error('empty');
    },
    deliver: async () => {
      delivered += 1;
      return 'download';
    },
    alert: (msg) => alerts.push(msg),
  });
  expect(result).toBe('empty');
  expect(delivered).toBe(0);
  expect(alerts[0]).toMatch(/empty/i);
});

test('runDocumentExport aborts a hung generation instead of waiting forever', async () => {
  const alerts = [];
  let delivered = 0;
  const result = await runDocumentExport({
    template: 'diary',
    mode: 'raster-pdf',
    timeoutMs: 20,
    rasterPdf: () => new Promise(() => {}),
    deliver: async () => {
      delivered += 1;
      return 'download';
    },
    alert: (msg) => alerts.push(msg),
  });
  expect(result).toBe('error');
  expect(delivered).toBe(0);
  expect(alerts[0]).toMatch(/too long/i);
});

test('runDocumentExport raster failure surfaces error without native fallback', async () => {
  const alerts = [];
  let nativeCalls = 0;
  const result = await runDocumentExport({
    template: 'diary',
    mode: 'raster-pdf',
    nativePrint: async () => {
      nativeCalls += 1;
      return 'ok';
    },
    rasterPdf: async () => {
      throw new Error('boom');
    },
    alert: (msg) => alerts.push(msg),
  });
  expect(result).toBe('error');
  expect(nativeCalls).toBe(0);
  expect(alerts[0]).toMatch(/Could not create PDF/i);
});
