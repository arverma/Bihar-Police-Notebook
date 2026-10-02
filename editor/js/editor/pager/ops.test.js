import { describe, expect, test } from 'vitest';
import {
    spillToNext,
    absorbFromNext,
    splitParagraph,
    splitList,
    normalizeContinuations,
    collapseTrailingPages,
    mapThroughPager,
    splitTable,
    tableCutIndex,
    tableMinRows,
    isHeaderRow,
} from './ops.js';
import { collectPages } from './layout.js';
import { letterTemplate, diaryTemplate } from '../templates.js';
import { letterDoc, diaryDoc, stateFor, posOf, columnPages } from '../test-helpers.js';

const cellStart = (doc, page, col) => collectPages(doc)[page].cells[col].pos + 1;

describe('spillToNext', () => {
    test('moves trailing blocks onto a new page and keeps the caret on the same character', () => {
        const doc = letterDoc([['one', 'two', 'three']]);
        const caret = posOf(doc, 'three', 2);
        const state = stateFor(doc, caret);
        const from = posOf(doc, 'two') - 1;
        const tr = spillToNext(state.tr, letterTemplate, 0, 'main', from);
        expect(columnPages(tr.doc, 'main')).toEqual([['one'], ['two', 'three']]);
        const $h = tr.selection.$head;
        expect($h.parent.textContent).toBe('three');
        expect($h.parentOffset).toBe(2);
        expect($h.index(0)).toBe(1);
    });

    test('a caret on the blank next page stays there, before the spilled text', () => {
        const doc = letterDoc([['a', 'b'], ['']]);
        const caretAt = collectPages(doc)[1].cells.main.pos + 2;
        const tr = spillToNext(stateFor(doc, caretAt).tr, letterTemplate, 0, 'main', posOf(doc, 'b') - 1);
        expect(columnPages(tr.doc, 'main')).toEqual([['a'], ['b']]);
        const $h = tr.selection.$head;
        expect($h.index(0)).toBe(1);
        expect($h.parent.textContent).toBe('b');
        expect($h.parentOffset).toBe(0);
    });

    test('prepends to an existing next page, replacing a blank placeholder cell', () => {
        const doc = letterDoc([['a', 'b'], ['']]);
        const tr = spillToNext(stateFor(doc).tr, letterTemplate, 0, 'main', posOf(doc, 'b') - 1);
        expect(columnPages(tr.doc, 'main')).toEqual([['a'], ['b']]);
    });

    test('a cut paragraph keeps its text and its tail rejoins an existing continuation', () => {
        // Page 2 already holds the tail of "abcdef" from an earlier cut.
        const doc = letterDoc([['x', 'abcd'], [{ t: 'ef', cont: true }, 'next']]);
        const tr = stateFor(doc).tr;
        const from = splitParagraph(tr, posOf(doc, 'abcd', 2));
        spillToNext(tr, letterTemplate, 0, 'main', from);
        expect(columnPages(tr.doc, 'main')).toEqual([['x', 'ab'], ['+cdef', 'next']]);
    });

    test('diary: spilling one column creates a page whose other column is blank and has no header', () => {
        const doc = diaryDoc([{ left: ['l1'], right: ['r1', 'r2'] }]);
        const tr = spillToNext(stateFor(doc).tr, diaryTemplate, 0, 'right', posOf(doc, 'r2') - 1);
        expect(columnPages(tr.doc, 'right')).toEqual([['r1'], ['r2']]);
        expect(columnPages(tr.doc, 'left')).toEqual([['l1'], ['']]);
        expect(tr.doc.child(1).attrs.hasHeader).toBe(false);
        expect(tr.doc.child(0).attrs.hasHeader).toBe(true);
    });
});

describe('absorbFromNext', () => {
    test('a caret on the blank line it replaces stays in that box, before the pulled-up text', () => {
        // Page 2's box was emptied (e.g. its only table deleted); the caret is there.
        const doc = diaryDoc([{ right: ['r1'] }, { left: ['l2'], right: [''] }, { left: ['l3'], right: ['moved', 'next'] }]);
        const caretAt = collectPages(doc)[1].cells.right.pos + 2;
        const tr = absorbFromNext(stateFor(doc, caretAt).tr, 1, 'right');
        expect(columnPages(tr.doc, 'right')).toEqual([['r1'], ['moved'], ['next']]);
        const $h = tr.selection.$head;
        expect($h.index(0)).toBe(1);
        expect($h.parent.textContent).toBe('moved');
        expect($h.parentOffset).toBe(0);
        expect($h.node($h.depth - 1).attrs.col).toBe('right');
    });

    test('re-joins a continuation with the paragraph it was cut from', () => {
        const doc = letterDoc([['p1', 'Hello wo'], [{ t: 'rld again', cont: true }, 'p3']]);
        const tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['p1', 'Hello world again'], ['p3']]);
    });

    // Regression: separate paragraphs must never weld when the page edge moves
    // (Enter above the last lines, then Backspace at the top of page 2 used to
    // turn "29 30 31 32" into "29303132").
    test('never joins separate paragraphs — the block sequence is invariant', () => {
        const doc = letterDoc([['28', '29'], ['30', '31', '32']]);
        let tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        tr = absorbFromNext(tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['28', '29', '30', '31'], ['32']]);
    });

    test('pulling the last block leaves a valid blank cell behind', () => {
        const doc = letterDoc([['a'], ['b']]);
        const tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['a', 'b'], ['']]);
        tr.doc.check();
    });

    test('caret inside the absorbed block moves with it', () => {
        const doc = letterDoc([['a'], ['bcd', 'e']]);
        const state = stateFor(doc, posOf(doc, 'bcd', 1));
        const tr = absorbFromNext(state.tr, 0, 'main');
        expect(tr.selection.$head.parent.textContent).toBe('bcd');
        expect(tr.selection.$head.parentOffset).toBe(1);
        expect(tr.selection.$head.index(0)).toBe(0);
    });

    test('a list cut across pages re-joins into one list with its numbering', () => {
        const doc = letterDoc([[{ ol: ['one', 'two'] }], [{ ol: ['three'], start: 3, cont: true }]]);
        const tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['ol(1):onetwothree'], ['']]);
    });
});

describe('splitList', () => {
    test('the tail list continues the numbering', () => {
        const doc = letterDoc([[{ ol: ['a', 'b', 'c'] }]]);
        const tr = stateFor(doc).tr;
        splitList(tr, cellStart(doc, 0, 'main'), 2);
        expect(columnPages(tr.doc, 'main')).toEqual([['ol(1):ab', '+ol(3):c']]);
    });
});

describe('normalizeContinuations', () => {
    test('the first page never continues anything', () => {
        const doc = letterDoc([[{ t: 'x', cont: true }]]);
        const tr = normalizeContinuations(stateFor(doc).tr);
        expect(columnPages(tr.doc, 'main')).toEqual([['x']]);
    });

    test('a continuation that is not first in its cell joins the block before it', () => {
        const doc = letterDoc([['a'], ['b', { t: 'c', cont: true }]]);
        const tr = normalizeContinuations(stateFor(doc).tr);
        expect(columnPages(tr.doc, 'main')).toEqual([['a'], ['bc']]);
    });
});

describe('collapseTrailingPages', () => {
    test('drops blank trailing pages but keeps the caret page', () => {
        const doc = letterDoc([['a'], [''], ['']]);
        expect(collapseTrailingPages(stateFor(doc).tr, letterTemplate, 0).doc.childCount).toBe(1);
        expect(collapseTrailingPages(stateFor(doc).tr, letterTemplate, 1).doc.childCount).toBe(2);
    });

    test('diary: keeps an empty page whose header the user switched on', () => {
        const doc = diaryDoc([{ right: ['a'] }, { hasHeader: true }]);
        expect(collapseTrailingPages(stateFor(doc).tr, diaryTemplate, 0).doc.childCount).toBe(2);
    });
});

describe('mapThroughPager', () => {
    test('follows text the pager moved to another page', () => {
        const doc = letterDoc([['a', 'word here']]);
        const before = posOf(doc, 'word here', 4);
        const tr = spillToNext(stateFor(doc).tr, letterTemplate, 0, 'main', posOf(doc, 'word') - 1);
        const after = mapThroughPager(tr, before);
        const $p = tr.doc.resolve(after);
        expect($p.parent.textContent).toBe('word here');
        expect($p.parentOffset).toBe(4);
        expect($p.index(0)).toBe(1);
    });
});

describe('tables', () => {
    const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => [`r${from + i}`, `x${from + i}`]);
    const tablePos = (doc, page = 0, index = 0) => {
        const cell = collectPages(doc)[page].cells.main;
        let pos = cell.pos + 1;
        for (let i = 0; i < index; i++) pos += cell.node.child(i).nodeSize;
        return pos;
    };

    test('splitTable cuts between rows; the tail is a continuation and spills like any block', () => {
        const doc = letterDoc([['intro', { table: [['H1', 'H2'], ...rows(3)], header: true }]]);
        const tr = stateFor(doc).tr;
        const from = splitTable(tr, tablePos(doc, 0, 1), 2);
        spillToNext(tr, letterTemplate, 0, 'main', from);
        expect(columnPages(tr.doc, 'main')).toEqual([
            ['intro', 'table:#H1,H2/r1,x1'],
            ['+table:r2,x2/r3,x3'],
        ]);
    });

    test('absorbing a table continuation re-joins it with the piece before it', () => {
        const doc = letterDoc([
            [{ table: [['H1', 'H2'], ...rows(1)], header: true }],
            [{ table: rows(2, 2), cont: true }, 'after'],
        ]);
        const tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['table:#H1,H2/r1,x1/r2,x2/r3,x3'], ['after']]);
    });

    test('a table continuation after a paragraph is not joined to it', () => {
        const doc = letterDoc([['p'], [{ table: rows(1), cont: true }]]);
        const tr = absorbFromNext(stateFor(doc).tr, 0, 'main');
        expect(columnPages(tr.doc, 'main')).toEqual([['p', 'table:r1,x1'], ['']]);
    });

    test('tableMinRows keeps a header row with its first body row', () => {
        const header = letterDoc([[{ table: [['H'], ['a'], ['b']], header: true }]]).child(0).child(0).child(0);
        const plain = letterDoc([[{ table: [['a'], ['b']] }]]).child(0).child(0).child(0);
        const cont = letterDoc([[{ table: [['H'], ['a']], header: true, cont: true }]]).child(0).child(0).child(0);
        expect(tableMinRows(header)).toBe(2);
        expect(tableMinRows(plain)).toBe(1);
        expect(tableMinRows(cont)).toBe(1);
        expect(isHeaderRow(header.firstChild)).toBe(true);
        expect(isHeaderRow(plain.firstChild)).toBe(false);
    });

    test('tableCutIndex never cuts through a rowspan and respects minRows', () => {
        const doc = letterDoc([[{ table: rows(5) }]]);
        const tr = stateFor(doc).tr;
        // Make row 1's first cell span rows 1-3.
        const table = doc.child(0).child(0).child(0);
        const cellPos = tablePos(doc) + 1 + table.child(0).nodeSize + 1;
        tr.setNodeMarkup(cellPos, null, { ...tr.doc.nodeAt(cellPos).attrs, rowspan: 3 });
        const spanned = tr.doc.child(0).child(0).child(0);
        expect(tableCutIndex(spanned, 4)).toBe(4);
        expect(tableCutIndex(spanned, 3)).toBe(1); // 2 and 3 are inside the span
        expect(tableCutIndex(spanned, 2)).toBe(1);
        expect(tableCutIndex(spanned, 0)).toBe(-1); // nothing fits: no cut
        expect(tableCutIndex(spanned, 1, 2)).toBe(-1);
        expect(tableCutIndex(spanned, -1)).toBe(-1);
    });
});
