/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest';
import { keyboardInset, wantsDock } from './keyboard-dock.js';

describe('keyboardInset', () => {
    test('is the gap between layout and visual viewport bottoms', () => {
        expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 0 } })).toBe(300);
    });

    test('accounts for the visual viewport being scrolled (iOS pans it)', () => {
        expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 120 } })).toBe(180);
    });

    test('is 0 with no keyboard, no visualViewport, or an over-tall viewport', () => {
        expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 800, offsetTop: 0 } })).toBe(0);
        expect(keyboardInset({ innerHeight: 800, visualViewport: null })).toBe(0);
        expect(keyboardInset({ innerHeight: 800, visualViewport: { height: 900, offsetTop: 0 } })).toBe(0);
    });
});

describe('wantsDock', () => {
    const toolbar = document.createElement('div');
    const toolbarBtn = document.createElement('button');
    toolbar.append(toolbarBtn);
    const editor = document.createElement('div');
    editor.className = 'bp-doc';
    // Diary header fields live inside the editor root but are not formattable.
    const headerInput = document.createElement('input');
    const headerField = document.createElement('span');
    editor.append(headerInput, headerField);
    document.body.append(toolbar, editor);

    test('shows when the user is in the document editor', () => {
        expect(wantsDock(editor, toolbar, true)).toBe(true);
    });

    test('stays up while focus is on the toolbar itself', () => {
        expect(wantsDock(toolbarBtn, toolbar, true)).toBe(true);
    });

    test('a diary header field inside the editor root does not raise it', () => {
        expect(wantsDock(headerInput, toolbar, true)).toBe(false);
        expect(wantsDock(headerField, toolbar, true)).toBe(false);
    });

    test('programmatic focus (no tap or key press) does not raise it', () => {
        expect(wantsDock(editor, toolbar, false)).toBe(false);
    });

    test('hides when nothing relevant is focused', () => {
        expect(wantsDock(null, toolbar, true)).toBe(false);
        expect(wantsDock(document.body, toolbar, true)).toBe(false);
    });
});
