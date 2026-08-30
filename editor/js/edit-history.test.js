/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest';
import { createEditHistory } from './edit-history.js';

test('markUserEdit pushes lastSettled and clears redo', () => {
  let t = 1000;
  const h = createEditHistory({ coalesceMs: 1000, now: () => t });
  h.settle({ n: 0 });
  expect(h.markUserEdit()).toBe(true);
  expect(h._undoLen).toBe(1);
  h.settle({ n: 1 });
  h.markUserEdit({ force: true });
  h.settle({ n: 2 });
  const undone = h.undoOnce();
  expect(undone).toEqual({ n: 1 });
  expect(h._redoLen).toBe(1);
  h.markUserEdit({ force: true });
  expect(h._redoLen).toBe(0);
});

test('coalesce window skips push but extends the window', () => {
  let t = 1000;
  const h = createEditHistory({ coalesceMs: 1000, now: () => t });
  h.settle({ n: 0 });
  expect(h.markUserEdit()).toBe(true);
  h.settle({ n: 1 });
  t = 1200;
  expect(h.markUserEdit()).toBe(false);
  expect(h._undoLen).toBe(1);
  t = 2100; // still within 1000ms of last mark (1200)
  expect(h.markUserEdit()).toBe(false);
  t = 3101; // past coalesce from 2100
  expect(h.markUserEdit()).toBe(true);
  expect(h._undoLen).toBe(2);
});

test('force bypasses coalesce', () => {
  let t = 1000;
  const h = createEditHistory({ coalesceMs: 1000, now: () => t });
  h.settle({ n: 0 });
  h.markUserEdit();
  h.settle({ n: 1 });
  t = 1100;
  expect(h.markUserEdit({ force: true })).toBe(true);
  expect(h._undoLen).toBe(2);
});

test('undo/redo pairing restores lastSettled', () => {
  const h = createEditHistory({ coalesceMs: 0 });
  h.settle('a');
  h.markUserEdit({ force: true });
  h.settle('b');
  h.markUserEdit({ force: true });
  h.settle('c');
  expect(h.undoOnce()).toBe('b');
  expect(h.lastSettled).toBe('b');
  expect(h.undoOnce()).toBe('a');
  expect(h.redoOnce()).toBe('b');
  expect(h.redoOnce()).toBe('c');
  expect(h.redoOnce()).toBe(null);
});

test('clear empties stacks and lastSettled', () => {
  const h = createEditHistory();
  h.settle('a');
  h.markUserEdit({ force: true });
  h.settle('b');
  h.clear();
  expect(h.lastSettled).toBe(null);
  expect(h.canUndo).toBe(false);
  expect(h.canRedo).toBe(false);
  expect(h.markUserEdit({ force: true })).toBe(false);
});

test('maxStack drops oldest entries', () => {
  const h = createEditHistory({ coalesceMs: 0, maxStack: 3 });
  for (let i = 0; i < 5; i++) {
    h.settle({ i });
    h.markUserEdit({ force: true });
  }
  expect(h._undoLen).toBe(3);
  // oldest kept is settle of i=1 pushed when marking for i=2? 
  // settle 0, mark push 0; settle 1, mark push 1; settle 2, mark push 2;
  // settle 3, mark push 3 (drop 0); settle 4, mark push 4 (drop 1)
  // undo stack = [2, 3, 4] as lastSettled values pushed
  expect(h.undoOnce()).toEqual({ i: 4 });
});

test('applying blocks mark and settle', () => {
  const h = createEditHistory();
  h.settle('a');
  h.applying = true;
  expect(h.markUserEdit({ force: true })).toBe(false);
  h.settle('b');
  expect(h.lastSettled).toBe('a');
});
