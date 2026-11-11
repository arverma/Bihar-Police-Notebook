/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { bindMenuTrigger, createPopMenu } from './popmenu.js';

let trigger, menu, a, b, c, outside;
beforeEach(() => {
    document.body.innerHTML = `
      <button id="t">Menu</button>
      <div id="m" role="menu" hidden>
        <button role="menuitem" id="a">A</button>
        <button role="menuitem" id="b" hidden>B</button>
        <button role="menuitemradio" aria-checked="true" id="c">C</button>
      </div>
      <button id="out">outside</button>`;
    [trigger, menu, a, b, c, outside] = ['t', 'm', 'a', 'b', 'c', 'out'].map((id) => document.getElementById(id));
});

const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('popmenu', () => {
    test('opens with aria-expanded and focuses the checked item, else the first', () => {
        const pm = createPopMenu(menu);
        bindMenuTrigger(trigger, pm);
        trigger.click();
        expect(menu.hidden).toBe(false);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(c);
        pm.close();
        c.setAttribute('aria-checked', 'false');
        trigger.click();
        expect(document.activeElement).toBe(a);
    });

    test('arrow keys rove over visible items only and wrap', () => {
        const pm = createPopMenu(menu);
        pm.open(trigger);
        a.focus();
        key(a, 'ArrowDown');
        expect(document.activeElement).toBe(c); // skips hidden B
        key(c, 'ArrowDown');
        expect(document.activeElement).toBe(a); // wraps
        key(a, 'ArrowUp');
        expect(document.activeElement).toBe(c);
        key(c, 'Home');
        expect(document.activeElement).toBe(a);
        key(a, 'End');
        expect(document.activeElement).toBe(c);
    });

    test('Escape closes and returns focus to the trigger', () => {
        const pm = createPopMenu(menu);
        pm.open(trigger);
        key(menu, 'Escape');
        expect(menu.hidden).toBe(true);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);
    });

    test('Tab and an outside press close without stealing focus', () => {
        const pm = createPopMenu(menu);
        pm.open(trigger);
        key(menu, 'Tab');
        expect(menu.hidden).toBe(true);
        pm.open(trigger);
        outside.focus();
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(menu.hidden).toBe(true);
        expect(document.activeElement).toBe(outside);
    });

    test('choosing an item closes the menu and the item handler still runs', () => {
        const pm = createPopMenu(menu);
        let ran = false;
        a.addEventListener('click', () => { ran = true; });
        pm.open(trigger);
        a.click();
        expect(ran).toBe(true);
        expect(menu.hidden).toBe(true);
    });

    test('clicking the trigger again toggles it shut; ArrowDown on the trigger opens', () => {
        const pm = createPopMenu(menu);
        bindMenuTrigger(trigger, pm);
        trigger.click();
        trigger.click();
        expect(menu.hidden).toBe(true);
        key(trigger, 'ArrowDown');
        expect(menu.hidden).toBe(false);
    });

    test('the same menu can be reopened for a different trigger (shared row menu)', () => {
        const pm = createPopMenu(menu);
        pm.open(trigger);
        pm.open(outside);
        expect(pm.trigger()).toBe(outside);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(outside.getAttribute('aria-expanded')).toBe('true');
    });
});
