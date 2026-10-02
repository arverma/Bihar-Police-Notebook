/**
 * A paged document sheet (letter or diary): one editor for the whole
 * document, with the app-facing API main.js uses — content in/out, undo,
 * page focus reporting, and the active text field for transliteration and
 * dictation.
 */
import { createDocEditor, loadDocContent } from './mount.js';
import { serializeDoc, parseDoc, docPlainText, docPages, docHasObjects } from './doc-format.js';
import { emptyLetterJSON, emptyDiaryJSON, diaryPageJSON } from './schema.js';
import { createTextField } from './text-field.js';
import { PAGER_META } from './pager/plugin.js';
import { pageIndexAt } from './pager/layout.js';
import { STRUCTURE_META } from './page-views.js';
import { TextSelection } from './tiptap.js';

/**
 * @typedef {object} SheetHooks
 * @property {() => void} [onChange]                      document changed (autosave)
 * @property {(el: HTMLElement) => void} [onAttachField]  wire transliteration on an editable
 * @property {(count: number) => void} [onPageCountChange]  pages added or removed
 * @property {(info: { toPage: number }) => void} [onSpill] caret carried onto a later page
 * @property {() => boolean} [isHeld]                     pause pagination (suggestion popup open)
 * @property {(ctx: {pageIndex:number, col:string}) => string} [placeholder]
 * @property {(message: string) => boolean} [confirm]
 */

/**
 * @param {HTMLElement} container
 * @param {'letter'|'diary'} template
 * @param {SheetHooks} hooks
 */
export function createDocSheet(container, template, hooks = {}) {
    const empty = template === 'diary' ? emptyDiaryJSON : emptyLetterJSON;
    let lastCaretPage = 0;
    let lastPageCount = 1;

    const editor = createDocEditor({
        element: container,
        template,
        isHeld: hooks.isHeld,
        placeholder: hooks.placeholder,
        pageHost: {
            onAttachField: hooks.onAttachField,
            confirm: hooks.confirm ?? ((m) => window.confirm(m)),
        },
        onUpdate: () => hooks.onChange?.(),
        onTransaction: (ed, tr) => {
            const page = pageIndexAt(ed.state.doc, ed.state.selection.head);
            const count = ed.state.doc.childCount;
            if (tr.getMeta(PAGER_META) && page > lastCaretPage && ed.view.hasFocus()) {
                hooks.onSpill?.({ toPage: page + 1 });
            }
            lastCaretPage = page;
            if (count !== lastPageCount) {
                lastPageCount = count;
                hooks.onPageCountChange?.(count);
            }
        },
    });
    const field = createTextField(editor);
    hooks.onAttachField?.(editor.view.dom);

    let addBtn = null;
    if (template === 'diary') {
        addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'diary-add-page screen-only';
        addBtn.title = 'Add a new diary page';
        addBtn.setAttribute('aria-label', 'Add a new diary page');
        addBtn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> Add page';
        addBtn.addEventListener('click', addPage);
        container.appendChild(addBtn);
    }

    /** Append a page without a header and put the caret in it. */
    function addPage() {
        const { state, view } = editor;
        const page = state.schema.nodeFromJSON(diaryPageJSON({ hasHeader: false }));
        const at = state.doc.content.size;
        const tr = state.tr.insert(at, page);
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + page.nodeSize - 2), -1));
        tr.setMeta(STRUCTURE_META, true);
        view.dispatch(tr);
        editor.commands.focus(undefined, { scrollIntoView: false });
    }

    /**
     * Whether stored content opens in this sheet: the saved format, and a
     * document valid against this template's schema (not damaged, not the
     * other template's document).
     */
    function canOpen(content) {
        if (!content) return true;
        const json = parseDoc(content);
        if (!json) return false;
        try {
            editor.schema.nodeFromJSON(json).check();
            return true;
        } catch {
            return false;
        }
    }

    /** Load stored content; unopenable content loads an empty document. */
    function setContent(content) {
        const doc = content && canOpen(content) ? parseDoc(content) : null;
        loadDocContent(editor, doc ?? empty());
        lastCaretPage = 0;
        lastPageCount = editor.state.doc.childCount;
        hooks.onPageCountChange?.(lastPageCount);
    }

    function getJSON() {
        return editor.getJSON();
    }

    function getPlainText() {
        return docPlainText(getJSON());
    }

    function hasMeaningfulContent() {
        if (getPlainText().trim()) return true;
        // A photo or an (empty) table is work too: it must be saved.
        if (docHasObjects(getJSON())) return true;
        if (template !== 'diary') return false;
        return docPages(getJSON()).some((p) => Object.entries(p.fields)
            .some(([k, v]) => k !== 'rule_no' && String(v ?? '').trim()));
    }

    return {
        editor,
        field,
        getContent: () => serializeDoc(getJSON()),
        canOpen,
        setContent,
        clear: () => setContent(null),
        focus: () => field.focus(),
        undo: () => editor.commands.undo(),
        redo: () => editor.commands.redo(),
        addPage,
        getPlainText,
        hasMeaningfulContent,
        /** Header attributes per page (diary). */
        getPages: () => docPages(getJSON()),
        /** Wait until pagination is idle (tests, export). */
        settle: () => editor.storage.pager.controller?.settle() ?? Promise.resolve(),
        /** Run pagination that was held (suggestion popup closed). */
        resumePagination: () => editor.storage.pager.controller?.schedule(),
        /** Re-evaluate placeholder text (language mode changed). */
        refreshPlaceholders: () => editor.view.dispatch(editor.state.tr.setMeta('bpPlaceholders', true)),
        getActiveField() {
            return { el: editor.view.dom, field, ...field.getSelection() };
        },
        get pageCount() { return editor.state.doc.childCount; },
        destroy() {
            addBtn?.remove();
            editor.destroy();
        },
    };
}
