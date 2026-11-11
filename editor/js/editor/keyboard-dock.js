import { MOBILE_QUERY } from '../layout.js';

/**
 * Phone formatting bar: docked flush above the on-screen keyboard, shown only
 * while a document editor has focus (the keyboard is up exactly then).
 *
 * `position: fixed; bottom: 0` is relative to the *layout* viewport, which the
 * keyboard does not resize on iOS and only overlays on current Android Chrome,
 * so the bar would sit hidden behind the keyboard. The *visual* viewport is
 * what the user actually sees: its bottom edge is the keyboard's top edge.
 * The bar's `bottom` is the gap between the two.
 *
 * Mobile layout only (see ../layout.js); above it the toolbar stays in the header
 * (styles in header-responsive.css key off `.is-docked`).
 */
export const PHONE_QUERY = MOBILE_QUERY;

/**
 * Gap between the layout viewport's bottom and the visual viewport's bottom,
 * i.e. the height of the on-screen keyboard (0 when there is none).
 * @param {{ innerHeight: number, visualViewport?: { height: number, offsetTop: number } | null }} win
 */
export function keyboardInset(win) {
    const vv = win.visualViewport;
    if (!vv) return 0;
    return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
}

/**
 * Whether the bar should be up. Focus must be on the document editor itself
 * (the Tiptap root, `.bp-doc`) — not on a diary header field (FIR, date…),
 * which lives inside that root but has nothing to format — or on the toolbar.
 * It must also come from the user (a tap or key press): the editor is also
 * focused programmatically on load and for a new document, when no keyboard
 * is up and a bar floating at the bottom would be noise.
 * @param {Element | null} active
 * @param {HTMLElement} toolbar
 * @param {boolean} engaged the user touched or typed since focus last left
 */
export function wantsDock(active, toolbar, engaged) {
    if (!active || !engaged) return false;
    return active.classList.contains('bp-doc') || toolbar.contains(active);
}

/**
 * @param {HTMLElement} toolbar
 * @returns {{ update: () => void }}
 */
export function initKeyboardDock(toolbar) {
    const phone = window.matchMedia(PHONE_QUERY);
    let frame = 0;
    let engaged = false;

    function apply() {
        frame = 0;
        const docked = phone.matches && wantsDock(document.activeElement, toolbar, engaged);
        toolbar.classList.toggle('is-docked', docked);
        document.documentElement.classList.toggle('format-docked', docked);
        toolbar.style.bottom = docked ? `${keyboardInset(window)}px` : '';
    }

    function update() {
        if (!frame) frame = requestAnimationFrame(apply);
    }

    // A tap on the editor or bar is the user's intent; a tap elsewhere is not.
    document.addEventListener('pointerdown', (e) => {
        const t = e.target instanceof Element ? e.target : null;
        engaged = Boolean(t && (t.closest('.bp-doc') || toolbar.contains(t)));
        update();
    }, true);
    document.addEventListener('keydown', () => { engaged = true; update(); }, true);
    document.addEventListener('focusin', update);
    // Focus moves editor → toolbar/other in one tick; wait it out before hiding.
    document.addEventListener('focusout', () => setTimeout(update, 0));
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    phone.addEventListener('change', update);
    update();

    return { update };
}
