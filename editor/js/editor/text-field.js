/**
 * Plain-text view of the editor for transliteration, dictation and the
 * suggestion popup — the same shape those features use for <input>s.
 *
 * Offsets are relative to the textblock holding the caret (the current
 * paragraph). Inside a textblock every inline node maps to exactly one
 * character (text 1:1, hard break = "\n"), so an offset converts to a
 * document position by simple addition and word boundaries work unchanged.
 */
import { TextSelection } from './tiptap.js';

/**
 * @param {import('./tiptap.js').Editor} editor
 */
export function createTextField(editor) {
    const leaf = (node) => (node.type.name === 'hardBreak' ? '\n' : '￼');

    /** Textblock around the selection head: { start, end, text }. */
    function block() {
        const $h = editor.state.selection.$head;
        if (!$h.parent.isTextblock) return null;
        const start = $h.start();
        const end = $h.end();
        return { start, end, text: editor.state.doc.textBetween(start, end, '\n', leaf) };
    }

    return {
        editor,
        el: editor.view.dom,

        getText() {
            return block()?.text ?? '';
        },

        /** Caret offset within the current paragraph. */
        getCaret() {
            const b = block();
            if (!b) return 0;
            return editor.state.selection.head - b.start;
        },

        /** Selection in paragraph offsets (clamped to the paragraph). */
        getSelection() {
            const b = block();
            if (!b) return { start: 0, end: 0 };
            const { from, to } = editor.state.selection;
            const clamp = (p) => Math.max(0, Math.min(p - b.start, b.end - b.start));
            return { start: clamp(from), end: clamp(to) };
        },

        setCaret(offset) {
            const b = block();
            if (!b) return;
            const pos = b.start + Math.max(0, Math.min(offset, b.end - b.start));
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
        },

        /**
         * Replace [start, end) of the current paragraph with text, keeping the
         * surrounding marks, and leave the caret after it.
         */
        replaceRange(start, end, text) {
            const b = block();
            if (!b) return;
            const size = b.end - b.start;
            const from = b.start + Math.max(0, Math.min(start, size));
            const to = b.start + Math.max(0, Math.min(end, size));
            const tr = editor.state.tr.insertText(text, from, to);
            tr.setSelection(TextSelection.create(tr.doc, from + text.length));
            editor.view.dispatch(tr);
        },

        /** Insert at the caret (replacing any selection). */
        insertAtCaret(text) {
            const { from, to } = editor.state.selection;
            const tr = editor.state.tr.insertText(text, from, to);
            editor.view.dispatch(tr);
        },

        /** Viewport rect of a paragraph offset (already includes page scale). */
        coordsAt(offset) {
            const b = block();
            if (!b) return null;
            const pos = b.start + Math.max(0, Math.min(offset, b.end - b.start));
            try {
                return editor.view.coordsAtPos(pos);
            } catch {
                return null;
            }
        },

        focus() {
            editor.commands.focus(undefined, { scrollIntoView: false });
        },
    };
}
