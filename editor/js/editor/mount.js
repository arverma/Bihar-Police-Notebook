/**
 * Create the paged document editor for a template.
 */
import { Editor, EditorState, Extension, Plugin, PluginKey, Decoration, DecorationSet } from './tiptap.js';
import { collectPages, isBlankCell } from './pager/layout.js';
import {
    DiaryPage,
    letterExtensions,
    diaryExtensions,
    emptyLetterJSON,
    emptyDiaryJSON,
} from './schema.js';
import { letterTemplate, diaryTemplate } from './templates.js';
import { Pager } from './pager/plugin.js';
import { PageStructure } from './structure.js';
import { DiaryPageView } from './page-views.js';

/**
 * Placeholder text in empty writing boxes. Computed from the state being
 * rendered, so it is always in step with pagination.
 */
const CellPlaceholder = Extension.create({
    name: 'cellPlaceholder',
    addOptions() {
        return { text: null };
    },
    addProseMirrorPlugins() {
        const { text } = this.options;
        return [new Plugin({
            key: new PluginKey('bpCellPlaceholder'),
            props: {
                decorations(state) {
                    if (!text) return null;
                    const decos = [];
                    for (const page of collectPages(state.doc)) {
                        for (const cell of Object.values(page.cells)) {
                            if (!isBlankCell(cell.node)) continue;
                            const label = text({ pageIndex: page.index, col: cell.col });
                            if (!label) continue;
                            const p = cell.pos + 1;
                            decos.push(Decoration.node(p, p + cell.node.firstChild.nodeSize, {
                                class: 'is-empty',
                                'data-placeholder': label,
                            }));
                        }
                    }
                    return DecorationSet.create(state.doc, decos);
                },
            },
        })];
    },
});

const TEMPLATES = {
    letter: {
        template: letterTemplate,
        empty: emptyLetterJSON,
        extensions: () => letterExtensions(),
    },
    diary: {
        template: diaryTemplate,
        empty: emptyDiaryJSON,
        extensions: (host) => diaryExtensions().map((ext) => (ext === DiaryPage
            ? DiaryPage.extend({ addNodeView: () => (props) => new DiaryPageView(props, host) })
            : ext)),
    },
};

/**
 * @param {object} opts
 * @param {HTMLElement} opts.element          Host; the editor root is appended to it.
 * @param {'letter'|'diary'} opts.template
 * @param {object} [opts.content]             ProseMirror doc JSON.
 * @param {() => boolean} [opts.isHeld]       Pause pagination while true (transliteration popup open).
 * @param {(ctx: {pageIndex:number, col:string}) => string} [opts.placeholder]
 * @param {import('./page-views.js').DiaryPageHost} [opts.pageHost]
 * @param {(editor: Editor) => void} [opts.onUpdate]
 * @param {(editor: Editor, tr: any) => void} [opts.onTransaction]
 * @param {(editor: Editor) => void} [opts.onSelectionUpdate]
 */
export function createDocEditor({
    element, template, content, isHeld, placeholder, pageHost, onUpdate, onTransaction, onSelectionUpdate,
}) {
    const t = TEMPLATES[template];
    if (!t) throw new Error(`Unknown template: ${template}`);
    /** @type {Editor} */
    let editor;
    const host = {
        ...pageHost,
        onLayoutChange: () => editor?.storage.pager.controller?.requestFull(),
    };
    editor = new Editor({
        element,
        extensions: [
            ...t.extensions(host),
            Pager.configure({ template: t.template, isHeld }),
            PageStructure,
            CellPlaceholder.configure({ text: placeholder }),
        ],
        content: content ?? t.empty(),
        injectCSS: false,
        enableInputRules: ['orderedList', 'bulletList'],
        enablePasteRules: false,
        editorProps: {
            attributes: { class: `bp-doc bp-doc-${template}`, spellcheck: 'false' },
            // Caret restores must not scroll the stage; the user scrolls.
            handleScrollToSelection: () => true,
        },
        onUpdate: ({ editor: ed }) => onUpdate?.(ed),
        onTransaction: ({ editor: ed, transaction }) => onTransaction?.(ed, transaction),
        onSelectionUpdate: ({ editor: ed }) => onSelectionUpdate?.(ed),
    });
    return editor;
}

/**
 * Replace the whole document (load / new document) with a fresh editor
 * state: no undo history carries over from the previous document, and no
 * transaction is recorded.
 */
export function loadDocContent(editor, json) {
    const { schema, plugins } = editor.state;
    const doc = schema.nodeFromJSON(json);
    doc.check();
    editor.view.updateState(EditorState.create({ schema, doc, plugins }));
    editor.storage.pager.controller?.requestFull();
}
