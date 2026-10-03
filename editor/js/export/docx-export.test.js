import { describe, it, expect, vi } from 'vitest';
import { runDocxExport, safeDocxName } from './docx-export.js';

const blob = new Blob(['x']);
const base = () => ({
  getJSON: () => ({ type: 'doc' }),
  hasContent: () => true,
  filename: 'My diary',
  build: vi.fn(async () => ({ blob, warnings: [] })),
  deliver: vi.fn(async () => 'download'),
  alert: vi.fn(),
});

describe('safeDocxName', () => {
  it('adds .docx once and strips characters Windows and macOS reject', () => {
    expect(safeDocxName('My diary')).toBe('My diary.docx');
    expect(safeDocxName('a/b:c*d?.docx')).toBe('a b c d.docx');
    expect(safeDocxName('  ')).toBe('Document.docx');
    expect(safeDocxName(undefined)).toBe('Document.docx');
    expect(safeDocxName('केस दैनिकी 12')).toBe('केस दैनिकी 12.docx');
  });
});

describe('runDocxExport', () => {
  it('builds from the editor JSON and delivers the named file', async () => {
    const d = base();
    expect(await runDocxExport(d)).toBe('ok');
    expect(d.build).toHaveBeenCalledWith({ type: 'doc' });
    expect(d.deliver).toHaveBeenCalledWith(blob, 'My diary.docx');
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('refuses a blank document without building', async () => {
    const d = { ...base(), hasContent: () => false };
    expect(await runDocxExport(d)).toBe('empty');
    expect(d.build).not.toHaveBeenCalled();
    expect(d.alert).toHaveBeenCalledWith('Cannot export empty document!');
  });

  it('delivers the file and then lists what was simplified', async () => {
    const d = { ...base(), build: vi.fn(async () => ({ blob, warnings: ['one', 'two'] })) };
    expect(await runDocxExport(d)).toBe('ok');
    expect(d.deliver).toHaveBeenCalled();
    expect(d.alert.mock.calls[0][0]).toContain('- one\n- two');
  });

  it('reports a failure instead of throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = { ...base(), build: vi.fn(async () => { throw new Error('boom'); }) };
    expect(await runDocxExport(d)).toBe('error');
    expect(d.deliver).not.toHaveBeenCalled();
    expect(d.alert).toHaveBeenCalledWith('Could not create the Word file. Please try again.');
    spy.mockRestore();
  });
});
