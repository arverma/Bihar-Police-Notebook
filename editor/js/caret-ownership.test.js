import { describe, it, expect } from 'vitest';
import { createCaretOwnership } from './caret-ownership.js';

describe('createCaretOwnership', () => {
  it('runs a deferred restore when nobody touched the caret', () => {
    const owner = createCaretOwnership();
    let ran = false;
    const restore = owner.owned(() => { ran = true; });
    restore();
    expect(ran).toBe(true);
  });

  it('drops a restore queued before the user placed the caret', () => {
    const owner = createCaretOwnership();
    let ran = false;
    const restore = owner.owned(() => { ran = true; });
    owner.noteUserCaret();
    restore();
    expect(ran).toBe(false);
  });

  it('keeps a restore queued after the user placed the caret', () => {
    const owner = createCaretOwnership();
    owner.noteUserCaret();
    let ran = false;
    const restore = owner.owned(() => { ran = true; });
    restore();
    expect(ran).toBe(true);
  });

  it('does not count the pager\'s own focus events as the user', () => {
    const owner = createCaretOwnership();
    let ran = false;
    // A restore whose own focus() call bubbles back into noteUserCaret must not
    // invalidate the restores queued alongside it.
    const first = owner.owned(() => { owner.noteUserCaret(); });
    const second = owner.owned(() => { ran = true; });
    first();
    second();
    expect(ran).toBe(true);
  });

  it('restores the outer attribution after a nested restore', () => {
    const owner = createCaretOwnership();
    let ran = false;
    const later = owner.owned(() => { ran = true; });
    owner.asRestore(() => {
      owner.asRestore(() => {});
      // Still inside the outer restore: this must not count as the user.
      owner.noteUserCaret();
    });
    later();
    expect(ran).toBe(true);
    // Outside any restore, it counts again.
    const after = owner.owned(() => {});
    owner.noteUserCaret();
    let ranAfter = false;
    const blocked = owner.owned(() => { ranAfter = true; });
    owner.noteUserCaret();
    blocked();
    expect(ranAfter).toBe(false);
    expect(typeof after).toBe('function');
  });

  it('a later user placement invalidates every restore queued before it', () => {
    const owner = createCaretOwnership();
    const ran = [];
    const a = owner.owned(() => ran.push('a'));
    const b = owner.owned(() => ran.push('b'));
    owner.noteUserCaret();
    const c = owner.owned(() => ran.push('c'));
    a(); b(); c();
    expect(ran).toEqual(['c']);
  });

  it('watchUserCaret marks a pointer press as a user placement', () => {
    const owner = createCaretOwnership();
    const listeners = {};
    const el = /** @type {any} */ ({
      addEventListener: (type, fn) => { listeners[type] = fn; },
    });
    owner.watchUserCaret(el);
    let ran = false;
    const restore = owner.owned(() => { ran = true; });
    listeners.mousedown();
    restore();
    expect(ran).toBe(false);
  });
});
