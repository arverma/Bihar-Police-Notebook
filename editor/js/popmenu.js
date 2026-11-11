/**
 * Minimal accessible popover menu (WAI-ARIA menu button pattern).
 *
 * The caller owns markup and positioning: `menu` is an element with
 * `role="menu"` holding `role="menuitem"` / `menuitemradio` buttons. This
 * module owns open/close, `aria-expanded`, roving focus (Arrow/Home/End),
 * Escape (closes and returns focus to the trigger), Tab (closes) and
 * outside-press dismissal, so every menu in the sidebar behaves the same.
 */

const ITEM = '[role="menuitem"], [role="menuitemradio"]';

/**
 * @param {HTMLElement} menu
 * @param {{ onOpen?: (trigger: HTMLElement) => void, onClose?: () => void }} [hooks]
 */
export function createPopMenu(menu, hooks = {}) {
    /** @type {HTMLElement | null} */
    let trigger = null;

    const items = () => /** @type {HTMLElement[]} */ (
        [...menu.querySelectorAll(ITEM)].filter((el) => !el.hidden && !el.closest('[hidden]') && !el.disabled)
    );
    const isOpen = () => !menu.hidden;

    function close(returnFocus = true) {
        if (!isOpen()) return;
        menu.hidden = true;
        trigger?.setAttribute('aria-expanded', 'false');
        const t = trigger;
        trigger = null;
        hooks.onClose?.();
        if (returnFocus && t?.isConnected) t.focus();
    }

    /** @param {HTMLElement} from */
    function open(from) {
        if (isOpen()) close(false);
        trigger = from;
        menu.hidden = false;
        from.setAttribute('aria-expanded', 'true');
        hooks.onOpen?.(from);
        (items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    }

    /** @param {HTMLElement} from */
    function toggle(from) {
        if (isOpen() && trigger === from) close();
        else open(from);
    }

    menu.addEventListener('keydown', (e) => {
        const list = items();
        const i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Tab') close(false);
    });

    // Choosing an item closes the menu; the item's own handler still runs.
    menu.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest(ITEM)) close();
    });

    document.addEventListener('pointerdown', (e) => {
        if (!isOpen() || !(e.target instanceof Node)) return;
        if (menu.contains(e.target) || trigger?.contains(e.target)) return;
        close(false);
    }, true);

    return { open, close, toggle, isOpen, trigger: () => trigger };
}

/**
 * Wire a button as a menu trigger: click toggles, ArrowDown opens.
 * @param {HTMLElement} button
 * @param {ReturnType<typeof createPopMenu>} popMenu
 */
export function bindMenuTrigger(button, popMenu) {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        popMenu.toggle(button);
    });
    button.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            popMenu.open(button);
        }
    });
}
