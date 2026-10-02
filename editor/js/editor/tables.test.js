/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Editor, TextSelection } from './tiptap.js';
import { letterExtensions } from './schema.js';
import { tablePieces, tableHasHeaderRow } from './tables.js';
import { letterDoc, columnPages, posOf } from './test-helpers.js';

let editor;
afterEach(() => editor?.destroy());

/** An editor (no pager) on a letter document; caret in the cell holding `at`. */
function open(pages, at) {
    editor = new Editor({
        element: document.body.appendChild(document.createElement('div')),
        extensions: letterExtensions(),
        content: letterDoc(pages).toJSON(),
        injectCSS: false,
    });
    if (at) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor.state.doc, at))));
    return editor;
}

const pages = () => columnPages(editor.state.doc, 'main');

/** Press a key in the editor the way a browser delivers it. */
function press(key, opts = {}) {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
}

/** A table split over two pages: header + r1 on page 1, r2..r3 on page 2. */
const SPLIT = [
    ['intro', { table: [['H1', 'H2'], ['r1', 'x1']], header: true }],
    [{ table: [['r2', 'x2'], ['r3', 'x3']], cont: true }, 'after'],
];

describe('tablePieces', () => {
    test('finds every piece of a split table from any piece', () => {
        open(SPLIT);
        const { doc } = editor.state;
        let first = -1;
        let second = -1;
        doc.descendants((n, pos) => {
            if (n.type.name !== 'table') return true;
            if (first < 0) first = pos;
            else second = pos;
            return false;
        });
        expect(tablePieces(doc, first).map((p) => p.pos)).toEqual([first, second]);
        expect(tablePieces(doc, second).map((p) => p.pos)).toEqual([first, second]);
    });

    test('a table followed by more text on its page is not chained to the next page', () => {
        open([[{ table: [['a']] }, 'text'], [{ table: [['b']], cont: true }]]);
        let first = -1;
        editor.state.doc.descendants((n, pos) => {
            if (n.type.name === 'table' && first < 0) first = pos;
            return first < 0;
        });
        expect(tablePieces(editor.state.doc, first)).toHaveLength(1);
    });
});

describe('table commands across pages', () => {
    test('adding a column from a continuation adds it to every piece', () => {
        open(SPLIT, 'x3');
        expect(editor.commands.addColumnAfter()).toBe(true);
        expect(pages()).toEqual([
            ['intro', 'table:#H1,H2,/r1,x1,'],
            ['+table:r2,x2,/r3,x3,', 'after'],
        ]);
    });

    test('adding a column on the left keeps the pieces aligned', () => {
        open(SPLIT, 'H2');
        editor.commands.addColumnBefore();
        expect(pages()).toEqual([
            ['intro', 'table:#H1,,H2/r1,,x1'],
            ['+table:r2,,x2/r3,,x3', 'after'],
        ]);
    });

    test('deleting a column removes it from every piece', () => {
        open(SPLIT, 'x2');
        expect(editor.commands.deleteColumn()).toBe(true);
        expect(pages()).toEqual([['intro', 'table:#H1/r1'], ['+table:r2/r3', 'after']]);
    });

    test('the header-row toggle on a continuation acts on the table\'s first row', () => {
        open(SPLIT, 'r2');
        expect(tableHasHeaderRow(editor.state)).toBe(true);
        editor.commands.toggleHeaderRow();
        expect(pages()[0][1]).toBe('table:H1,H2/r1,x1');
        expect(pages()[1][0]).toBe('+table:r2,x2/r3,x3');
        expect(tableHasHeaderRow(editor.state)).toBe(false);
        editor.commands.toggleHeaderRow();
        expect(pages()[0][1]).toBe('table:#H1,H2/r1,x1');
    });

    test('delete table removes every piece and keeps the caret in the same box', () => {
        open(SPLIT, 'r2');
        expect(editor.commands.deleteTable()).toBe(true);
        expect(pages()).toEqual([['intro'], ['after']]);
        const $h = editor.state.selection.$head;
        expect($h.index(0)).toBe(0);
        expect($h.parent.textContent).toBe('intro');
    });

    test('deleting a row inside one piece leaves the rest of the table alone', () => {
        open(SPLIT, 'r3');
        editor.commands.deleteRow();
        expect(pages()).toEqual([['intro', 'table:#H1,H2/r1,x1'], ['+table:r2,x2', 'after']]);
    });

    test('deleting the last row of a continuation removes that piece', () => {
        open([
            [{ table: [['H'], ['r1']], header: true }],
            [{ table: [['r2']], cont: true }, 'after'],
        ], 'r2');
        expect(editor.commands.deleteRow()).toBe(true);
        expect(pages()).toEqual([['table:#H/r1'], ['after']]);
    });

    test('deleting every row of the first piece promotes the next piece to the table start', () => {
        open([
            [{ table: [['r1']] }],
            [{ table: [['r2']], cont: true }],
        ], 'r1');
        editor.commands.deleteRow();
        expect(pages()).toEqual([[''], ['table:r2']]);
    });

    test('deleting the only row of a one-piece table deletes the table', () => {
        open([['p', { table: [['only']] }]], 'only');
        editor.commands.deleteRow();
        expect(pages()).toEqual([['p']]);
    });
});

describe('insertFlowTable', () => {
    test('inserts a 3x3 table with a header row and puts the caret in its first cell', () => {
        open([['line']], 'line');
        editor.commands.setTextSelection(posOf(editor.state.doc, 'line', 4));
        expect(editor.commands.insertFlowTable()).toBe(true);
        expect(pages()).toEqual([['line', 'table:#,,/,,/,,', '']]);
        expect(editor.isActive('tableHeader')).toBe(true);
    });

    test('is refused inside a table (no nested tables)', () => {
        open([[{ table: [['a']] }]], 'a');
        expect(editor.can().insertFlowTable()).toBe(false);
    });
});

describe('Tab', () => {
    test('moves from the last cell of a piece to the first cell of the next piece', () => {
        open(SPLIT, 'x1');
        press('Tab');
        const $h = editor.state.selection.$head;
        expect($h.index(0)).toBe(1);
        expect($h.parent.textContent).toBe('r2');
    });

    test('Shift+Tab moves back into the previous piece', () => {
        open(SPLIT, 'r2');
        press('Tab', { shiftKey: true });
        const $h = editor.state.selection.$head;
        expect($h.index(0)).toBe(0);
        expect($h.parent.textContent).toBe('x1');
    });

    test('Tab in the very last cell adds a row', () => {
        open(SPLIT, 'x3');
        press('Tab');
        expect(pages()[1][0]).toBe('+table:r2,x2/r3,x3/,');
    });
});

describe('repeated header', () => {
    test('a continuation shows its table\'s header row, outside the document', () => {
        open(SPLIT);
        const repeats = editor.view.dom.querySelectorAll('.bp-table-repeat');
        expect(repeats).toHaveLength(1);
        expect(repeats[0].textContent).toBe('H1H2');
        expect(repeats[0].getAttribute('aria-hidden')).toBe('true');
        expect(pages()[1][0]).toBe('+table:r2,x2/r3,x3');
    });

    test('follows edits to the header and disappears when the header row is turned off', () => {
        open(SPLIT, 'H1');
        editor.commands.insertContent('!');
        expect(editor.view.dom.querySelector('.bp-table-repeat').textContent).toBe('!H1H2');
        editor.commands.toggleHeaderRow();
        expect(editor.view.dom.querySelector('.bp-table-repeat')).toBeNull();
    });
});
