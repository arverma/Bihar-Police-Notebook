import { describe, expect, test } from 'vitest';
import { stepsStayInCells, backspaceAcrossPage, deleteAcrossPage } from './structure.js';
import { collectPages } from './pager/layout.js';
import { letterDoc, diaryDoc, stateFor, posOf, columnPages } from './test-helpers.js';

/** Run a command; return the resulting state, or null when it declined. */
function run(cmd, state) {
    let next = null;
    const ok = cmd(state, (tr) => { next = state.apply(tr); });
    return ok ? next : null;
}

describe('stepsStayInCells', () => {
    test('allows edits inside one cell', () => {
        const doc = letterDoc([['hello']]);
        const tr = stateFor(doc).tr.insertText('x', posOf(doc, 'hello', 1));
        expect(stepsStayInCells(tr)).toBe(true);
    });

    test('rejects a replace that spans two pages', () => {
        const doc = letterDoc([['a'], ['b']]);
        const tr = stateFor(doc).tr.delete(posOf(doc, 'a'), posOf(doc, 'b'));
        expect(stepsStayInCells(tr)).toBe(false);
    });

    test('rejects a replace that spans the two diary columns', () => {
        const doc = diaryDoc([{ left: ['left'], right: ['right'] }]);
        const tr = stateFor(doc).tr.delete(posOf(doc, 'left'), posOf(doc, 'right'));
        expect(stepsStayInCells(tr)).toBe(false);
    });
});

describe('Backspace at the top of a page', () => {
    test('in a continuation: deletes the character before the page edge', () => {
        const doc = letterDoc([['Hello wo'], [{ t: 'rld', cont: true }]]);
        const next = run(backspaceAcrossPage, stateFor(doc, posOf(doc, 'rld')));
        expect(columnPages(next.doc, 'main')).toEqual([['Hello w'], ['+rld']]);
        expect(next.selection.$head.parent.textContent).toBe('Hello w');
        expect(next.selection.$head.parentOffset).toBe(7);
    });

    test('in a separate paragraph: joins it onto the previous page, caret at the junction', () => {
        const doc = letterDoc([['first'], ['second', 'third']]);
        const next = run(backspaceAcrossPage, stateFor(doc, posOf(doc, 'second')));
        expect(columnPages(next.doc, 'main')).toEqual([['firstsecond'], ['third']]);
        expect(next.selection.$head.parentOffset).toBe(5);
        expect(next.selection.$head.index(0)).toBe(0);
    });

    test('stays in its own column in the diary', () => {
        const doc = diaryDoc([{ left: ['L1'], right: ['R1'] }, { left: ['L2'], right: ['R2'] }]);
        const next = run(backspaceAcrossPage, stateFor(doc, posOf(doc, 'R2')));
        expect(columnPages(next.doc, 'right')).toEqual([['R1R2'], ['']]);
        expect(columnPages(next.doc, 'left')).toEqual([['L1'], ['L2']]);
    });

    test('does nothing on the first page or mid-paragraph', () => {
        const doc = letterDoc([['a'], ['bc']]);
        expect(run(backspaceAcrossPage, stateFor(doc, posOf(doc, 'a')))).toBeNull();
        expect(run(backspaceAcrossPage, stateFor(doc, posOf(doc, 'bc', 1)))).toBeNull();
    });
});

describe('Delete at the bottom of a page', () => {
    test('pulls the next page\'s separate paragraph up onto the caret line', () => {
        const doc = letterDoc([['first'], ['second']]);
        const next = run(deleteAcrossPage, stateFor(doc, posOf(doc, 'first', 5)));
        expect(columnPages(next.doc, 'main')).toEqual([['firstsecond'], ['']]);
        expect(next.selection.$head.parentOffset).toBe(5);
    });

    test('in front of a continuation: deletes its first character', () => {
        const doc = letterDoc([['Hello wo'], [{ t: 'rld', cont: true }]]);
        const next = run(deleteAcrossPage, stateFor(doc, posOf(doc, 'Hello wo', 8)));
        expect(columnPages(next.doc, 'main')).toEqual([['Hello wo'], ['+ld']]);
    });
});

test('helpers address real cells', () => {
    const doc = diaryDoc([{ left: ['x'] }]);
    expect(Object.keys(collectPages(doc)[0].cells)).toEqual(['left', 'right']);
});
