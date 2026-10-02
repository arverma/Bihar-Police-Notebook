/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from 'vitest';
import { Editor, TextSelection } from './tiptap.js';
import { letterExtensions } from './schema.js';
import { createTextField } from './text-field.js';

let editor;
afterEach(() => editor?.destroy());

function mount(paragraph) {
    editor = new Editor({
        element: document.createElement('div'),
        extensions: letterExtensions(),
        content: {
            type: 'doc',
            content: [{ type: 'letterPage', content: [{ type: 'flowCell', attrs: { col: 'main' }, content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'first line' }] },
                paragraph,
            ] }] }],
        },
    });
    return createTextField(editor);
}

function caretIn(text, offset) {
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
        if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1 + offset;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

test('reads the current paragraph and the caret offset within it', () => {
    const field = mount({ type: 'paragraph', content: [{ type: 'text', text: 'namaste duniya' }] });
    caretIn('namaste duniya', 7);
    expect(field.getText()).toBe('namaste duniya');
    expect(field.getCaret()).toBe(7);
});

test('replaceRange swaps a word and keeps its formatting', () => {
    const field = mount({ type: 'paragraph', content: [{ type: 'text', text: 'namaste', marks: [{ type: 'bold' }] }] });
    caretIn('namaste', 7);
    field.replaceRange(0, 7, 'नमस्ते ');
    const para = editor.state.selection.$head.parent;
    expect(para.textContent).toBe('नमस्ते ');
    expect(para.firstChild.marks.map((m) => m.type.name)).toEqual(['bold']);
    expect(field.getCaret()).toBe('नमस्ते '.length);
});

test('a hard break counts as one character, so offsets match positions', () => {
    const field = mount({ type: 'paragraph', content: [
        { type: 'text', text: 'ab' }, { type: 'hardBreak' }, { type: 'text', text: 'cd' },
    ] });
    caretIn('abcd', 5);
    expect(field.getText()).toBe('ab\ncd');
    field.replaceRange(3, 5, 'XY');
    expect(editor.state.selection.$head.parent.textContent).toBe('abXY');
});
