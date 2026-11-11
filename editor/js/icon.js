/**
 * Build an icon element for DOM-created controls. Matches the markup used in
 * index.html (an `<i class="fas …">` element, aria-hidden); the artwork lives
 * in css/icons.css, and js/icons.test.js checks every name has a rule there.
 * @param {string} name  icon name without the `fa-` prefix, e.g. 'rotate-left'
 */
export function iconEl(name) {
    const i = document.createElement('i');
    i.className = `fas fa-${name}`;
    i.setAttribute('aria-hidden', 'true');
    return i;
}

/** A text node wrapper so a label can sit beside an icon in a flex button. */
export function textSpan(text) {
    const s = document.createElement('span');
    s.textContent = text;
    return s;
}
