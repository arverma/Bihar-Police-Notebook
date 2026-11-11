import { describe, expect, test } from 'vitest';
import { stepsStayInCells, backspaceAcrossPage, deleteAcrossPage } from './structure.js';
import { TextSelection, ReplaceStep } from './tiptap.js';
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

describe('clearing a whole cell (select all, then delete)', () => {
    /** Selection covering every line of the right-hand cell: first text to last text. */
    function selectCellText(doc, first, last) {
        const from = posOf(doc, first);
        const to = posOf(doc, last, last.length);
        return stateFor(doc).tr.setSelection(TextSelection.create(doc, from, to));
    }

    test('deleting a multi-line selection of one cell is allowed', () => {
        const doc = diaryDoc([{ left: ['L'], right: ['first', 'second'] }]);
        const tr = selectCellText(doc, 'first', 'second').deleteSelection();
        expect(stepsStayInCells(tr)).toBe(true);
    });

    test('...including when the last line is empty (the reported case)', () => {
        const doc = diaryDoc([{ left: ['L'], right: ['first', ''] }]);
        const state = stateFor(doc);
        const cell = collectPages(doc)[0].cells.right;
        const from = posOf(doc, 'first');
        const to = cell.pos + 1 + cell.node.content.size - 1; // inside the empty last paragraph
        const tr = state.tr.setSelection(TextSelection.create(doc, from, to)).deleteSelection();
        expect(stepsStayInCells(tr)).toBe(true);
        expect(columnPages(state.apply(tr).doc, 'right')).toEqual([['']]);
    });

    test('the cell survives, emptied, and the other column is untouched', () => {
        const doc = diaryDoc([{ left: ['L'], right: ['first', 'second'] }]);
        const state = stateFor(doc);
        const tr = selectCellText(doc, 'first', 'second').deleteSelection();
        const next = state.apply(tr);
        expect(columnPages(next.doc, 'right')).toEqual([['']]);
        expect(columnPages(next.doc, 'left')).toEqual([['L']]);
    });

    test('still rejects removing the cell itself (empty replacement)', () => {
        const doc = diaryDoc([{ left: ['L'], right: ['only'] }]);
        const $in = doc.resolve(posOf(doc, 'only'));
        let d = $in.depth;
        while ($in.node(d).type.name !== 'flowCell') d--;
        const step = new ReplaceStep($in.before(d), $in.after(d), doc.slice(0, 0));
        // The guard only reads `steps` and `docs`; skip validity checks on purpose.
        expect(stepsStayInCells({ steps: [step], docs: [doc] })).toBe(false);
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
