/**
 * Table editing controls drawn on the table itself.
 *
 * While the pointer is over a table (or, without a pointer, the caret is in
 * one) the table shows:
 *  - a grip left of the row and above the column of the current cell; each
 *    opens a labelled menu for that row / column,
 *  - a "+" bar under the table (add row) and right of it (add column).
 * Right-click (or Shift+F10 / the Menu key) in a cell opens one menu with
 * every row, column and table action.
 *
 * The controls sit in one fixed layer on <body>, placed from the cells'
 * on-screen rects, so the page boxes' clipping and the page scale never
 * affect them. Every action first moves the selection into the target cell
 * and then runs the same editor command as a keyboard user would
 * (./tables.js), so undo, pagination and split tables behave as for typing.
 */
import { Selection } from './tiptap.js';
import { tableHasHeaderRow } from './tables.js';

/**
 * @typedef {{ label: string, icon: string, cmd: string, checked?: (ed: any) => boolean, danger?: boolean }} Item
 */

/** @type {Record<string, Item>} */
const ITEMS = {
    rowBefore: { label: 'Insert row above', icon: 'fa-arrow-up', cmd: 'addRowBefore' },
    rowAfter: { label: 'Insert row below', icon: 'fa-arrow-down', cmd: 'addRowAfter' },
    deleteRow: { label: 'Delete row', icon: 'fa-minus', cmd: 'deleteRow', danger: true },
    colBefore: { label: 'Insert column left', icon: 'fa-arrow-left', cmd: 'addColumnBefore' },
    colAfter: { label: 'Insert column right', icon: 'fa-arrow-right', cmd: 'addColumnAfter' },
    deleteCol: { label: 'Delete column', icon: 'fa-minus', cmd: 'deleteColumn', danger: true },
    header: { label: 'Header row', icon: 'fa-heading', cmd: 'toggleHeaderRow', checked: (ed) => tableHasHeaderRow(ed.state) },
    deleteTable: { label: 'Delete table', icon: 'fa-trash-can', cmd: 'deleteTable', danger: true },
};

/** Menus by kind; `null` is a separator. */
const MENUS = {
    row: ['rowBefore', 'rowAfter', 'deleteRow', null, 'header', null, 'deleteTable'],
    col: ['colBefore', 'colAfter', 'deleteCol', null, 'deleteTable'],
    cell: ['rowBefore', 'rowAfter', 'colBefore', 'colAfter', null, 'deleteRow', 'deleteCol', null, 'header', 'deleteTable'],
};

/** How far (px) outside a table the pointer may go before its controls hide. */
const HOVER_SLACK = 28;

const CELL_SELECTOR = '.bp-table td, .bp-table th';

/**
 * @param {() => any} getEditor  the active document editor, or null
 */
export function initTableControls(getEditor) {
    const layer = document.createElement('div');
    layer.className = 'table-controls screen-only';
    layer.hidden = true;
    layer.innerHTML = `
        <button type="button" class="tc-grip tc-grip-row" data-menu="row" tabindex="-1"
            title="Row options" aria-label="Row options" aria-haspopup="menu"><span aria-hidden="true"></span></button>
        <button type="button" class="tc-grip tc-grip-col" data-menu="col" tabindex="-1"
            title="Column options" aria-label="Column options" aria-haspopup="menu"><span aria-hidden="true"></span></button>
        <button type="button" class="tc-add tc-add-row" data-add="row" tabindex="-1"
            title="Add row" aria-label="Add row"><i class="fas fa-plus" aria-hidden="true"></i></button>
        <button type="button" class="tc-add tc-add-col" data-add="col" tabindex="-1"
            title="Add column" aria-label="Add column"><i class="fas fa-plus" aria-hidden="true"></i></button>
        <div class="tc-menu" role="menu" hidden></div>`;
    document.body.appendChild(layer);

    const q = (sel) => /** @type {HTMLElement} */ (layer.querySelector(sel));
    const gripRow = q('.tc-grip-row');
    const gripCol = q('.tc-grip-col');
    const addRow = q('.tc-add-row');
    const addCol = q('.tc-add-col');
    const menu = q('.tc-menu');

    /** The cell the controls belong to (hovered, else the caret's). */
    let cell = /** @type {HTMLElement | null} */ (null);
    /** The cell under the pointer, while it is over (or near) a table. */
    let hoverCell = /** @type {HTMLElement | null} */ (null);
    /** The editor the open menu acts on. */
    let menuEditor = null;

    /** A document cell (not the repeated header of a continuation) of `ed`. */
    function docCell(ed, target) {
        const el = target instanceof Element ? target.closest(CELL_SELECTOR) : null;
        if (!(el instanceof HTMLElement) || !ed?.view.dom.contains(el)) return null;
        if (el.closest('.bp-table-repeat')) return null;
        return el;
    }

    function caretCell(ed) {
        if (!ed || !(ed.isFocused || ed.view.hasFocus()) || !ed.isActive('table')) return null;
        const { node } = ed.view.domAtPos(ed.state.selection.from);
        return docCell(ed, node instanceof Element ? node : node.parentElement);
    }

    /** Put the selection in `el` unless it already is (keeps a multi-cell selection). */
    function selectCell(ed, el) {
        if (el.classList.contains('selectedCell')) return;
        const { node } = ed.view.domAtPos(ed.state.selection.from);
        const current = (node instanceof Element ? node : node.parentElement)?.closest('td, th');
        if (current === el) return;
        const pos = ed.view.posAtDOM(el, 0);
        ed.view.dispatch(ed.state.tr.setSelection(Selection.near(ed.state.doc.resolve(pos))));
    }

    function place(el, left, top, width, height) {
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        if (width != null) el.style.width = `${Math.round(width)}px`;
        if (height != null) el.style.height = `${Math.round(height)}px`;
    }

    function sync() {
        const ed = getEditor();
        if (hoverCell && !hoverCell.isConnected) hoverCell = null;
        const next = !menu.hidden && cell?.isConnected ? cell : (hoverCell || caretCell(ed));
        cell = next;
        if (!cell) {
            layer.hidden = true;
            return;
        }
        const table = cell.closest('table');
        const row = cell.parentElement;
        if (!table || !row) {
            layer.hidden = true;
            return;
        }
        layer.hidden = false;
        const t = table.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        const grip = gripRow.offsetWidth || 16;
        place(gripRow, t.left - grip - 4, r.top + r.height / 2 - gripRow.offsetHeight / 2);
        place(gripCol, c.left + c.width / 2 - gripCol.offsetWidth / 2, t.top - gripCol.offsetHeight - 4);
        place(addRow, t.left, t.bottom + 3, t.width, null);
        place(addCol, t.right + 3, t.top, null, t.height);
    }

    function closeMenu({ refocus = false } = {}) {
        if (menu.hidden) return;
        menu.hidden = true;
        menu.replaceChildren();
        layer.querySelectorAll('[aria-expanded]').forEach((b) => b.removeAttribute('aria-expanded'));
        const ed = menuEditor;
        menuEditor = null;
        if (refocus) ed?.view.focus();
        sync();
    }

    /**
     * @param {'row' | 'col' | 'cell'} kind
     * @param {{ x: number, y: number }} at  viewport point for the menu's corner
     * @param {HTMLElement | null} opener
     */
    function openMenu(kind, at, opener) {
        const ed = getEditor();
        if (!ed || !cell) return;
        selectCell(ed, cell);
        menuEditor = ed;
        menu.replaceChildren();
        menu.setAttribute('aria-label', kind === 'row' ? 'Row' : kind === 'col' ? 'Column' : 'Table');
        for (const key of MENUS[kind]) {
            if (!key) {
                const sep = document.createElement('div');
                sep.className = 'tc-menu-sep';
                sep.setAttribute('role', 'separator');
                menu.appendChild(sep);
                continue;
            }
            const item = ITEMS[key];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tc-menu-item';
            btn.dataset.tableCmd = key;
            btn.tabIndex = -1;
            if (item.danger) btn.classList.add('is-danger');
            if (item.checked) {
                btn.setAttribute('role', 'menuitemcheckbox');
                btn.setAttribute('aria-checked', item.checked(ed) ? 'true' : 'false');
            } else {
                btn.setAttribute('role', 'menuitem');
            }
            btn.disabled = !ed.can()[item.cmd]?.();
            btn.innerHTML = `<i class="fas ${item.icon}" aria-hidden="true"></i><span></span>`;
            /** @type {HTMLElement} */ (btn.querySelector('span')).textContent = item.label;
            menu.appendChild(btn);
        }
        menu.hidden = false;
        opener?.setAttribute('aria-expanded', 'true');
        // Keep the menu inside the viewport.
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        const x = Math.min(Math.max(8, at.x), window.innerWidth - w - 8);
        const below = at.y + h + 8 > window.innerHeight ? at.y - h : at.y;
        const y = Math.min(Math.max(8, below), window.innerHeight - h - 8);
        place(menu, x, y);
        items()[0]?.focus();
    }

    const items = () => /** @type {HTMLButtonElement[]} */ ([...menu.querySelectorAll('.tc-menu-item:not(:disabled)')]);

    function run(ed, cmd) {
        ed.chain().focus()[cmd]().run();
    }

    // Grips and "+" bars never take focus from the text.
    layer.addEventListener('mousedown', (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('.tc-menu')) e.preventDefault();
    });

    layer.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const ed = getEditor();
        if (!target || !ed) return;

        const grip = /** @type {HTMLElement | null} */ (target.closest('[data-menu]'));
        if (grip && cell) {
            if (!menu.hidden && grip.getAttribute('aria-expanded') === 'true') {
                closeMenu({ refocus: true });
                return;
            }
            closeMenu();
            const b = grip.getBoundingClientRect();
            const kind = /** @type {'row' | 'col'} */ (grip.dataset.menu);
            openMenu(kind, kind === 'row' ? { x: b.right + 4, y: b.top } : { x: b.left, y: b.bottom + 4 }, grip);
            return;
        }

        const add = /** @type {HTMLElement | null} */ (target.closest('[data-add]'));
        if (add && cell) {
            const table = cell.closest('table');
            const lastRow = table?.querySelector('tr:last-child');
            // Add at the end: from the last row's cell in this column / this row's last cell.
            const anchor = add.dataset.add === 'row'
                ? lastRow?.children[Math.min(cell.cellIndex, lastRow.children.length - 1)]
                : cell.parentElement?.lastElementChild;
            if (anchor instanceof HTMLElement) {
                selectCell(ed, anchor);
                run(ed, add.dataset.add === 'row' ? 'addRowAfter' : 'addColumnAfter');
            }
            return;
        }

        const item = /** @type {HTMLButtonElement | null} */ (target.closest('[data-table-cmd]'));
        if (item && !item.disabled && menuEditor) {
            // Focus the text before the focused item is removed with the menu.
            const edForMenu = menuEditor;
            edForMenu.view.focus();
            run(edForMenu, ITEMS[item.dataset.tableCmd || ''].cmd);
            closeMenu();
        }
    });

    menu.addEventListener('keydown', (e) => {
        const list = items();
        const i = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            list[(i + step + list.length) % list.length]?.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault();
            closeMenu({ refocus: true });
        }
    });

    document.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const target = e.target instanceof Element ? e.target : null;
        if (target && layer.contains(target)) return;
        const over = docCell(getEditor(), target);
        if (over) {
            hoverCell = over;
        } else if (hoverCell) {
            const t = hoverCell.closest('table')?.getBoundingClientRect();
            const near = t && e.clientX > t.left - HOVER_SLACK && e.clientX < t.right + HOVER_SLACK
                && e.clientY > t.top - HOVER_SLACK && e.clientY < t.bottom + HOVER_SLACK;
            if (!near) hoverCell = null;
        }
        if (over !== cell) sync();
    }, { passive: true });

    document.addEventListener('pointerdown', (e) => {
        if (!menu.hidden && !(e.target instanceof Element && layer.contains(e.target))) closeMenu();
    }, true);

    document.addEventListener('contextmenu', (e) => {
        const target = docCell(getEditor(), e.target);
        if (!target) return;
        e.preventDefault();
        closeMenu();
        cell = target;
        openMenu('cell', { x: e.clientX, y: e.clientY }, null);
    });

    document.addEventListener('keydown', (e) => {
        if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
        const target = caretCell(getEditor());
        if (!target) return;
        e.preventDefault();
        closeMenu();
        cell = target;
        const c = target.getBoundingClientRect();
        openMenu('cell', { x: c.left, y: c.bottom + 4 }, null);
    });

    // Scrolling, resizing or re-scaling the page moves the cells under the
    // fixed layer. The page scale settles after the resize event, so place
    // the controls again on the next frame.
    let frame = 0;
    const reflow = () => {
        if (!menu.hidden) closeMenu();
        else if (!layer.hidden) sync();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => sync());
    };
    document.addEventListener('scroll', reflow, { capture: true, passive: true });
    window.addEventListener('resize', () => {
        hoverCell = null;
        reflow();
    });
    window.visualViewport?.addEventListener('resize', reflow);
    // Fit-to-width and pinch zoom change the page scale with an inline style.
    const scaleEl = document.getElementById('editorScale');
    if (scaleEl) new MutationObserver(reflow).observe(scaleEl, { attributes: true, attributeFilter: ['style', 'class'] });

    sync();
    return { sync, element: layer };
}
