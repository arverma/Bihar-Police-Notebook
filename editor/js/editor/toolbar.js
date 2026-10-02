/**
 * Floating format toolbar (#formatToolbar).
 *
 * Buttons carry `data-cmd`; each maps to one editor command. The toolbar acts
 * on whichever document editor is active (letter or diary) and mirrors the
 * selection's formatting in `aria-pressed`. Mousedown is prevented so a click
 * never takes focus or the selection away from the text.
 */

/** @type {Record<string, { run: (ed: any) => void, active: (ed: any) => boolean }>} */
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

    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-cmd]') : null;
        const ed = getEditor();
        if (!(btn instanceof HTMLElement) || !ed || btn.disabled) return;
        COMMANDS[btn.dataset.cmd || '']?.run(ed);
        sync();
    });

    function sync() {
        const ed = getEditor();
        const usable = Boolean(ed?.isFocused || ed?.view.hasFocus());
        el.querySelectorAll('[data-cmd]').forEach((btn) => {
            const cmd = COMMANDS[btn.getAttribute('data-cmd') || ''];
            const on = Boolean(cmd && ed && cmd.active(ed));
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            /** @type {HTMLButtonElement} */ (btn).disabled = !ed;
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
