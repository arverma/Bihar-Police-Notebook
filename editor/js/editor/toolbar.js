/**
 * Floating format toolbar (#formatToolbar).
 *
 * Buttons carry `data-cmd`; each maps to one editor command. The toolbar acts
 * on whichever document editor is active (letter or diary) and mirrors the
 * selection's formatting in `aria-pressed` (toggle commands only). Mousedown
 * is prevented so a click never takes focus or the selection away from the
 * text.
 *
 * The table group (`data-group="table"`) is shown only while the caret is in
 * a table. Insert image opens the toolbar's file input (camera on phones).
 */
import { insertImageFiles } from './images.js';
import { tableHasHeaderRow } from './tables.js';

/**
 * @typedef {{
 *   run: (ed: any, ui: { pickImage: () => void }) => void,
 *   active?: (ed: any) => boolean,
 *   enabled?: (ed: any) => boolean,
 * }} Command
 */

/** @type {Record<string, Command>} */
const COMMANDS = {
    bold: { run: (ed) => ed.chain().focus().toggleBold().run(), active: (ed) => ed.isActive('bold') },
    italic: { run: (ed) => ed.chain().focus().toggleItalic().run(), active: (ed) => ed.isActive('italic') },
    underline: { run: (ed) => ed.chain().focus().toggleUnderline().run(), active: (ed) => ed.isActive('underline') },
    'align:center': {
        run: (ed) => toggleAlign(ed, 'center'),
        active: (ed) => ed.isActive({ textAlign: 'center' }),
    },
    'align:justify': {
        run: (ed) => toggleAlign(ed, 'justify'),
        active: (ed) => ed.isActive({ textAlign: 'justify' }),
    },
    'list:ordered': { run: (ed) => ed.chain().focus().toggleOrderedList().run(), active: (ed) => ed.isActive('orderedList') },
    'list:bullet': { run: (ed) => ed.chain().focus().toggleBulletList().run(), active: (ed) => ed.isActive('bulletList') },
    // Images and tables go between blocks, never inside a table.
    image: { run: (_ed, ui) => ui.pickImage(), enabled: (ed) => !ed.isActive('table') },
    table: { run: (ed) => ed.chain().focus().insertFlowTable().run(), enabled: (ed) => ed.can().insertFlowTable() },
    'table:rowBefore': { run: (ed) => ed.chain().focus().addRowBefore().run(), enabled: (ed) => ed.can().addRowBefore() },
    'table:rowAfter': { run: (ed) => ed.chain().focus().addRowAfter().run(), enabled: (ed) => ed.can().addRowAfter() },
    'table:colBefore': { run: (ed) => ed.chain().focus().addColumnBefore().run(), enabled: (ed) => ed.can().addColumnBefore() },
    'table:colAfter': { run: (ed) => ed.chain().focus().addColumnAfter().run(), enabled: (ed) => ed.can().addColumnAfter() },
    'table:deleteRow': { run: (ed) => ed.chain().focus().deleteRow().run(), enabled: (ed) => ed.can().deleteRow() },
    'table:deleteCol': { run: (ed) => ed.chain().focus().deleteColumn().run(), enabled: (ed) => ed.can().deleteColumn() },
    'table:header': {
        run: (ed) => ed.chain().focus().toggleHeaderRow().run(),
        active: (ed) => tableHasHeaderRow(ed.state),
        enabled: (ed) => ed.can().toggleHeaderRow(),
    },
    'table:delete': { run: (ed) => ed.chain().focus().deleteTable().run(), enabled: (ed) => ed.can().deleteTable() },
};

function toggleAlign(ed, value) {
    const chain = ed.chain().focus();
    if (ed.isActive({ textAlign: value })) chain.unsetTextAlign().run();
    else chain.setTextAlign(value).run();
}

/**
 * @param {HTMLElement} el
 * @param {() => any} getEditor  the active document editor, or null
 */
export function initFormatToolbar(el, getEditor) {
    el.hidden = false;

    const fileInput = /** @type {HTMLInputElement | null} */ (el.querySelector('input[type="file"]'));
    const tableGroup = /** @type {HTMLElement | null} */ (el.querySelector('[data-group="table"]'));
    // The editor whose selection the picked files go to (the picker blurs it).
    let pickFor = null;
    const ui = {
        pickImage() {
            pickFor = getEditor();
            fileInput?.click();
        },
    };
    fileInput?.addEventListener('change', () => {
        const files = [...(fileInput.files || [])];
        fileInput.value = '';
        const ed = pickFor;
        pickFor = null;
        if (ed && files.length) void insertImageFiles(ed, files);
    });

    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-cmd]') : null;
        const ed = getEditor();
        if (!(btn instanceof HTMLButtonElement) || !ed || btn.disabled) return;
        COMMANDS[btn.dataset.cmd || '']?.run(ed, ui);
        sync();
    });

    function sync() {
        const ed = getEditor();
        const usable = Boolean(ed?.isFocused || ed?.view.hasFocus());
        const inTable = Boolean(ed && usable && ed.isActive('table'));
        if (tableGroup) tableGroup.hidden = !inTable;
        el.querySelectorAll('[data-cmd]').forEach((btn) => {
            const cmd = COMMANDS[btn.getAttribute('data-cmd') || ''];
            if (!cmd) return;
            if (cmd.active) {
                const on = Boolean(ed && cmd.active(ed));
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
            // Table commands are only checked while their group is visible.
            const inGroup = tableGroup?.contains(btn);
            const enabled = Boolean(ed) && (inGroup && !inTable ? true : (cmd.enabled?.(ed) ?? true));
            /** @type {HTMLButtonElement} */ (btn).disabled = !enabled;
        });
        el.classList.toggle('is-idle', !usable);
        updateViewportOffset();
    }

    function updateViewportOffset() {
        // On narrow viewports lift the toolbar above the soft keyboard.
        const narrow = window.matchMedia?.('(max-width: 768px)').matches;
        if (!narrow) {
            el.style.removeProperty('--format-tb-bottom');
            return;
        }
        const vv = window.visualViewport;
        const keyboardLift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
        const bottomPx = Math.max(12, keyboardLift + 8);
        el.style.setProperty('--format-tb-bottom', `calc(var(--overlay-bottom, 0px) + ${bottomPx}px)`);
    }

    window.addEventListener('resize', updateViewportOffset);
    window.visualViewport?.addEventListener('resize', updateViewportOffset);
    window.visualViewport?.addEventListener('scroll', updateViewportOffset);

    sync();
    return { sync };
}
