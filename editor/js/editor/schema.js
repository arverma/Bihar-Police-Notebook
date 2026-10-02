/**
 * Document schema for the paged editors.
 *
 *   letter doc = letterPage+     letterPage = flowCell[col=main]
 *   diary doc  = diaryPage+      diaryPage  = flowCell[col=left] flowCell[col=right]
 *                                             attrs { hasHeader, fields{HEADER_FIELDS} }
 *
 * A flowCell is one fixed-height writing box on one page. The pager
 * (./pager/) keeps each column flowing across pages by moving blocks between
 * same-column cells.
 *
 * Writing boxes also hold images (./images.js) and tables (./tables.js).
 *
 * `cont` on a paragraph, list or table marks the tail of a block the pager cut at a
 * page edge: "this continues the last block of the previous page's cell in
 * this column". Absorbing re-joins it — and only it. Blocks without `cont`
 * are separate paragraphs and are never joined, so moving the page boundary
 * can never change the document.
 *
 * The diary page header (case-diary number, thana, …) is stored as attributes
 * of the page and edited through the page's node view (./diary-page-view.js).
 */
import {
    Node,
    mergeAttributes,
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Underline,
    HardBreak,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    TextAlign,
    UndoRedo,
    Gapcursor,
} from './tiptap.js';
import { HEADER_FIELDS, emptyHeader } from './diary-geometry.js';
import { FlowImage } from './images.js';
import { FlowTable, FlowTableRow, FlowTableCell, FlowTableHeader } from './tables.js';

/** `cont` attribute shared by paragraphs and lists. */
const contAttribute = {
    cont: {
        default: false,
        // Enter inside a continuation starts a new, independent paragraph.
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-cont') === 'true',
        renderHTML: (attrs) => (attrs.cont ? { 'data-cont': 'true' } : {}),
    },
};

const FlowParagraph = Paragraph.extend({
    addAttributes() {
        return { ...this.parent?.(), ...contAttribute };
    },
});

const FlowOrderedList = OrderedList.extend({
    addAttributes() {
        return { ...this.parent?.(), ...contAttribute };
    },
});

const FlowBulletList = BulletList.extend({
    addAttributes() {
        return { ...this.parent?.(), ...contAttribute };
    },
});

export const FlowCell = Node.create({
    name: 'flowCell',
    // Images are never cut; tables are cut between rows (see ./tables.js).
    content: '(paragraph | bulletList | orderedList | image | table)+',
    isolating: true,
    defining: true,
    addAttributes() {
        return {
            col: {
                default: 'main',
                parseHTML: (el) => el.getAttribute('data-col') || 'main',
                renderHTML: (attrs) => ({ 'data-col': attrs.col }),
            },
        };
    },
    parseHTML() {
        return [
            { tag: 'td.bp-cell-host', contentElement: '.bp-cell' },
            { tag: 'div.bp-cell' },
        ];
    },
    renderHTML({ node, HTMLAttributes }) {
        const col = node.attrs.col;
        if (col === 'main') {
            return ['div', mergeAttributes(HTMLAttributes, { class: 'bp-cell hinglish-input' }), 0];
        }
        // Diary cells sit in the form's two-column table.
        return [
            'td',
            { class: `bp-cell-host ${col}-column` },
            ['div', { class: 'diary-cell' }, ['div', mergeAttributes(HTMLAttributes, { class: 'bp-cell fir-input hinglish-input' }), 0]],
        ];
    },
});

export const LetterPage = Node.create({
    name: 'letterPage',
    content: 'flowCell',
    isolating: true,
    parseHTML() {
        return [{ tag: 'section.letter-page' }];
    },
    renderHTML() {
        return ['section', { class: 'bp-page letter-page' }, 0];
    },
    // No node view: a letter page has no chrome; the footer is CSS.
});

export const DiaryPage = Node.create({
    name: 'diaryPage',
    content: 'flowCell flowCell',
    isolating: true,
    addAttributes() {
        return {
            hasHeader: { default: false },
            fields: { default: emptyHeader() },
        };
    },
    parseHTML() {
        return [{ tag: 'section.diary-page' }];
    },
    renderHTML() {
        // Live rendering always goes through the node view; this is only
        // used for clipboard serialization.
        return ['section', { class: 'bp-page diary-page' }, ['table', { class: 'fir-table' }, ['tbody', ['tr', 0]]]];
    },
});

/** Extensions shared by every template. `doc` is supplied per template. */
function sharedExtensions() {
    return [
        Text,
        FlowParagraph,
        Bold,
        Italic,
        Underline,
        HardBreak,
        FlowImage,
        FlowTable,
        FlowTableRow,
        FlowTableCell,
        FlowTableHeader,
        FlowBulletList,
        FlowOrderedList,
        ListItem,
        ListKeymap,
        TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
        UndoRedo.configure({ depth: 100, newGroupDelay: 1000 }),
        // A caret before/after a table or image that starts or ends a box.
        Gapcursor,
        FlowCell,
    ];
}

export function letterExtensions() {
    return [Document.extend({ content: 'letterPage+' }), LetterPage, ...sharedExtensions()];
}

export function diaryExtensions() {
    return [Document.extend({ content: 'diaryPage+' }), DiaryPage, ...sharedExtensions()];
}

/** JSON for an empty cell. */
export function emptyCellJSON(col) {
    return { type: 'flowCell', attrs: { col }, content: [{ type: 'paragraph' }] };
}

export function emptyLetterJSON() {
    return { type: 'doc', content: [{ type: 'letterPage', content: [emptyCellJSON('main')] }] };
}

/** One diary page; the first page of a document shows the header. */
export function diaryPageJSON({ hasHeader = false, fields = emptyHeader() } = {}) {
    return {
        type: 'diaryPage',
        attrs: { hasHeader, fields: { ...fields } },
        content: [emptyCellJSON('left'), emptyCellJSON('right')],
    };
}

export function emptyDiaryJSON() {
    return { type: 'doc', content: [diaryPageJSON({ hasHeader: true })] };
}

export { HEADER_FIELDS };
