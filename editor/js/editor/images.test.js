/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Editor, TextSelection, NodeSelection } from './tiptap.js';
import { letterExtensions } from './schema.js';
import { insertBlock } from './insert-block.js';
import { clampWidth } from './images.js';
import { fitWithin, altFromFileName, imageFilesFrom, MAX_EDGE } from './image-file.js';
import { letterSchema, letterDoc, stateFor, posOf, columnPages } from './test-helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const image = (width = null) => letterSchema.nodes.image.create({ src: PNG, width });

/** Insert an image with the caret at `text`+`offset`; return the column and caret text. */
function insertAt(pages, text, offset) {
    const doc = letterDoc(pages);
    const state = stateFor(doc, posOf(doc, text, offset));
    const tr = state.tr;
    const ok = insertBlock(tr, image());
    return { ok, pages: columnPages(tr.doc, 'main'), caret: tr.selection.$head.parent.textContent, tr };
}

describe('insertBlock', () => {
    test('mid-line: splits the paragraph and puts the image between the halves', () => {
        const r = insertAt([['abcdef']], 'abcdef', 3);
        expect(r.pages).toEqual([['abc', 'img', 'def']]);
        expect(r.caret).toBe('def');
    });

    test('end of a line: the image goes after it, with a new line to keep typing on', () => {
        const r = insertAt([['abc']], 'abc', 3);
        expect(r.pages).toEqual([['abc', 'img', '']]);
        expect(r.tr.selection.$head.parent.type.name).toBe('paragraph');
        expect(r.caret).toBe('');
    });

    test('start of a line: the image goes before it and the caret stays put', () => {
        const r = insertAt([['abc']], 'abc', 0);
        expect(r.pages).toEqual([['img', 'abc']]);
        expect(r.caret).toBe('abc');
        expect(r.tr.selection.$head.parentOffset).toBe(0);
    });

    test('an empty line becomes the image', () => {
        const doc = letterDoc([['a', '', 'b']]);
        let empty = -1;
        doc.descendants((n, pos) => {
            if (n.type.name === 'paragraph' && n.content.size === 0) empty = pos + 1;
            return empty < 0;
        });
        const tr = stateFor(doc, empty).tr;
        insertBlock(tr, image());
        expect(columnPages(tr.doc, 'main')).toEqual([['a', 'img', '', 'b']]);
    });

    test('inside a table cell: the image goes after the table, never into it', () => {
        const r = insertAt([[{ table: [['cell']] }, 'after']], 'cell', 2);
        expect(r.pages).toEqual([['table:cell', 'img', 'after']]);
    });

    test('inside a list: the image goes after the list', () => {
        const r = insertAt([[{ ol: ['one', 'two'] }]], 'one', 1);
        expect(r.pages).toEqual([['ol(1):onetwo', 'img', '']]);
    });

    test('a selected range is replaced', () => {
        const doc = letterDoc([['hello world']]);
        const tr = stateFor(doc).tr.setSelection(TextSelection.create(doc, posOf(doc, 'hello', 5), posOf(doc, 'world')));
        insertBlock(tr, image());
        expect(columnPages(tr.doc, 'main')).toEqual([['hello', 'img', 'world']]);
    });

    test('two blocks in a row each keep a line after them', () => {
        const r = insertAt([['abc']], 'abc', 3);
        insertBlock(r.tr, image());
        expect(columnPages(r.tr.doc, 'main')).toEqual([['abc', 'img', 'img', '']]);
    });
});

describe('image width', () => {
    test('clampWidth keeps whole percentages in [10, 100]; anything else means natural size', () => {
        expect(clampWidth(55.4)).toBe(55);
        expect(clampWidth('40%')).toBe(40);
        expect(clampWidth(3)).toBe(10);
        expect(clampWidth(100)).toBe(100);
        expect(clampWidth(300)).toBeNull(); // a pixel width from older pasted HTML
        expect(clampWidth(null)).toBeNull();
        expect(clampWidth('wide')).toBeNull();
    });

    let editor;
    afterEach(() => editor?.destroy());
    const open = (html) => {
        editor = new Editor({
            element: document.body.appendChild(document.createElement('div')),
            extensions: letterExtensions(),
            content: letterDoc([['x']]).toJSON(),
            injectCSS: false,
        });
        editor.commands.setTextSelection(posOf(editor.state.doc, 'x', 1));
        editor.commands.insertContent(html);
        const found = [];
        editor.state.doc.descendants((n) => {
            if (n.type.name === 'image') found.push(n.attrs);
        });
        return found;
    };

    test('pasted HTML keeps a data: image and its percentage width', () => {
        expect(open(`<img src="${PNG}" data-width="40">`)).toEqual([{ src: PNG, alt: null, title: null, width: 40 }]);
    });

    test('pasted HTML drops remote images, so a document never depends on a server', () => {
        expect(open('<img src="https://example.com/a.png">')).toEqual([]);
    });

    test('the node view renders the stored width on its box and an empty alt by default', () => {
        editor = new Editor({
            element: document.body.appendChild(document.createElement('div')),
            extensions: letterExtensions(),
            content: letterDoc([[{ img: PNG, width: 35 }, 'x']]).toJSON(),
            injectCSS: false,
        });
        const box = editor.view.dom.querySelector('.bp-image');
        expect(box.style.width).toBe('35%');
        expect(box.querySelector('img').getAttribute('alt')).toBe('');
        expect(box.querySelector('.bp-image-handle').classList.contains('screen-only')).toBe(true);
    });

    test('Alt+→ widens a selected image by one step; undo right after inserting keeps the image', () => {
        editor = new Editor({
            element: document.body.appendChild(document.createElement('div')),
            extensions: letterExtensions(),
            content: letterDoc([['x']]).toJSON(),
            injectCSS: false,
        });
        editor.commands.setTextSelection(posOf(editor.state.doc, 'x', 1));
        // Type, insert and resize within the history's grouping delay.
        editor.commands.insertContent('y');
        editor.commands.command(({ tr, state }) => insertBlock(tr, state.schema.nodes.image.create({ src: PNG, width: 40 })));
        let pos = -1;
        editor.state.doc.descendants((n, p) => {
            if (n.type.name === 'image') pos = p;
            return pos < 0;
        });
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
        expect(editor.state.doc.nodeAt(pos).attrs.width).toBe(50);
        expect(editor.state.selection).toBeInstanceOf(NodeSelection);
        editor.commands.undo();
        expect(editor.state.doc.nodeAt(pos)?.attrs.width).toBe(40);
        editor.commands.undo();
        expect(columnPages(editor.state.doc, 'main')).toEqual([['xy']]);
    });
});

describe('image files', () => {
    test('fitWithin scales the long edge down to the limit and never enlarges', () => {
        expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1200 });
        expect(fitWithin(1000, 5000)).toEqual({ width: 320, height: MAX_EDGE });
        expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    });

    test('altFromFileName makes a readable label', () => {
        expect(altFromFileName('site_photo-2.JPG')).toBe('site photo 2');
        expect(altFromFileName('')).toBe('');
    });

    test('imageFilesFrom keeps only image files', () => {
        const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.txt', { type: 'text/plain' })];
        expect(imageFilesFrom({ files }).map((f) => f.name)).toEqual(['a.png']);
        expect(imageFilesFrom(null)).toEqual([]);
    });
});
