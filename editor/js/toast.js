/**
 * A short-lived toast with one action (e.g. "Moved to Trash" + Undo).
 *
 * Accessible: announced through a polite live region, the action is a real
 * button reachable by keyboard, and the timer pauses while the pointer or
 * keyboard focus is on the toast so it cannot vanish under the user.
 * Only one toast shows at a time; a new one replaces the old.
 */
import { iconEl, textSpan } from './icon.js';

const DEFAULT_MS = 8000;

/** @type {{ el: HTMLElement, dismiss: () => void } | null} */
let current = null;

/**
 * @param {{ message: string, actionLabel: string, actionIcon?: string, onAction: () => void | Promise<void>, duration?: number }} opts
 * @returns {() => void} dismiss
 */
export function showActionToast({ message, actionLabel, actionIcon, onAction, duration = DEFAULT_MS }) {
    current?.dismiss();

    const el = document.createElement('div');
    el.className = 'action-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    if (actionIcon) {
        button.className = 'has-icon';
        button.append(iconEl(actionIcon), textSpan(actionLabel));
    } else {
        button.textContent = actionLabel;
    }
    el.append(text, button);
    document.body.appendChild(el);

    let timer = null;
    let done = false;
    const dismiss = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.remove();
        if (current?.el === el) current = null;
    };
    const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(dismiss, duration);
    };
    const hold = () => clearTimeout(timer);

    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointerleave', arm);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', arm);
    button.addEventListener('click', async () => {
        dismiss();
        await onAction();
    });
    arm();

    current = { el, dismiss };
    return dismiss;
}
