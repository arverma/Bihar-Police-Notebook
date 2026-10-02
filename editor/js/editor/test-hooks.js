/**
 * `window.__bpTest`: read and drive the document editors from end-to-end
 * tests through document state, never through DOM internals, so a test can
 * never change what it is measuring by reading it.
 *
 * Block specs (setDoc): see ./block-spec.js — paragraphs, continuations,
 * lists, tables and images.
 */
import { TextSelection } from './tiptap.js';
import { serializeDoc } from './doc-format.js';
import { collectPages, cellContentRange } from './pager/layout.js';
import { emptyHeader } from './diary-geometry.js';
import { blockJSON, tableText } from './block-spec.js';

const cell = (col, blocks = []) => ({
    type: 'flowCell',
    attrs: { col },
    content: (blocks.length ? blocks : ['']).map(blockJSON),
});

/**
 * @param {{ letter: any, diary: any, active: () => any }} sheets
 */
export function createTestHooks(sheets) {
    const sheetFor = (template) => (template ? sheets[template] : sheets.active());

    function cellAt(ed, page, col) {
        const p = collectPages(ed.state.doc)[page];
        if (!p) throw new Error(`no page ${page}`);
        const c = p.cells[col];
        if (!c) throw new Error(`no ${col} cell on page ${page}`);
        return c;
    }

    return {
        /**
         * Load a document. Letter: pages = [[blocks]]; diary: pages =
         * [{ left, right, hasHeader, fields }].
         */
        setDoc(pages, template) {
            const sheet = sheetFor(template);
            const kind = template ?? (sheet === sheets.letter ? 'letter' : 'diary');
            const content = kind === 'letter'
                ? pages.map((blocks) => ({ type: 'letterPage', content: [cell('main', blocks)] }))
                : pages.map((p, i) => ({
                    type: 'diaryPage',
                    attrs: { hasHeader: p.hasHeader ?? i === 0, fields: { ...emptyHeader(), ...(p.fields || {}) } },
                    content: [cell('left', p.left), cell('right', p.right)],
                }));
            sheet.setContent(serializeDoc({ type: 'doc', content }));
        },

        /** Blocks per page of a column: [['a', '+b'], ...]; '+' marks a continuation. */
        pages(col, template) {
            const ed = sheetFor(template).editor;
            return collectPages(ed.state.doc).map((p) => {
                const out = [];
                p.cells[col]?.node.forEach((b) => {
                    const label = b.type.name === 'table' ? `table:${tableText(b)}` : b.type.name === 'image' ? 'img' : b.textContent;
                    out.push((b.attrs.cont ? '+' : '') + label);
                });
                return out;
            });
        },

        /** Logical blocks of a column in reading order (continuations re-joined). */
        blocks(col, template) {
            const out = [];
            for (const page of this.pages(col, template)) {
                for (const b of page) {
                    if (b.startsWith('+') && out.length) out[out.length - 1] += b.slice(1);
                    else out.push(b);
                }
            }
            return out;
        },

        cellText(page, col, template) {
            const { node } = cellAt(sheetFor(template).editor, page, col);
            return node.textBetween(0, node.content.size, '\n');
        },

        pageCount(template) {
            return sheetFor(template).editor.state.doc.childCount;
        },

        headers(template) {
            return sheetFor(template).getPages();
        },

        /** Caret: page, column, the paragraph's text and the offset within it. */
        caret(template) {
            const ed = sheetFor(template).editor;
            const $h = ed.state.selection.$head;
            let col = null;
            for (let d = $h.depth; d > 0; d--) {
                if ($h.node(d).type.name === 'flowCell') { col = $h.node(d).attrs.col; break; }
            }
            return {
                page: $h.index(0),
                col,
                text: $h.parent.textContent,
                offset: $h.parentOffset,
                empty: ed.state.selection.empty,
                focused: ed.view.hasFocus(),
            };
        },

        /**
         * Put the caret in a cell: in block `block` (default last) at `offset`
         * (default end), or at `{ start: true }`.
         */
        setCaret({ page = 0, col, block, offset, start = false, focus = true }, template) {
            const sheet = sheetFor(template);
            const ed = sheet.editor;
            const c = cellAt(ed, page, col ?? (sheet === sheets.letter ? 'main' : 'right'));
            let pos;
            if (start) {
                pos = TextSelection.near(ed.state.doc.resolve(cellContentRange(c).start), 1).from;
            } else {
                const index = block ?? c.node.childCount - 1;
                let p = c.pos + 1;
                for (let i = 0; i < index; i++) p += c.node.child(i).nodeSize;
                const $text = TextSelection.near(ed.state.doc.resolve(p + 1), 1).$from;
                const len = $text.parent.content.size;
                pos = $text.start() + Math.max(0, Math.min(offset ?? len, len));
            }
            if (focus) ed.view.focus();
            ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
        },

        /** Cells whose content is clipped by their box (should always be empty). */
        clipped(template) {
            const ed = sheetFor(template).editor;
            const out = [];
            ed.view.dom.querySelectorAll('.bp-cell').forEach((c) => {
                const last = c.lastElementChild;
                if (!last) return;
                const r = c.getBoundingClientRect();
                const s = c.offsetHeight ? r.height / c.offsetHeight : 1;
                const limit = r.top + (c.clientHeight - (parseFloat(getComputedStyle(c).paddingBottom) || 0)) * s;
                const over = last.getBoundingClientRect().bottom - limit;
                if (over > 0.5) {
                    out.push({ page: [...ed.view.dom.children].indexOf(c.closest('.bp-page')) + 1, col: c.dataset.col, overflowPx: over });
                }
            });
            return out;
        },

        settle(template) {
            return sheetFor(template).settle();
        },

        stats(template) {
            return { ...sheetFor(template).editor.storage.pager.stats };
        },

        content(template) {
            return sheetFor(template).getContent();
        },
    };
}
