/**
 * Node views for pages.
 *
 * A page view owns everything on the page that is not document text: the
 * screen-only chrome, and (diary) the form header with its native inputs.
 * ProseMirror only manages `contentDOM` — the writing cells — so:
 *
 *  - `stopEvent` hands every event outside contentDOM to the browser, so
 *    typing in a header input never reaches the editor's input handling;
 *  - `ignoreMutation` tells ProseMirror that DOM changes outside contentDOM
 *    (input values, the box-height CSS variable, button labels) are ours and
 *    must not be re-parsed into the document;
 *  - header edits become transactions (`setNodeAttribute` on the page), so
 *    they autosave and undo exactly like body text;
 *  - `update()` writes values back only to inputs the user is not typing in,
 *    so an undo refreshes the header without fighting an active caret or IME.
 */
import { undoDepth } from './tiptap.js';
import { HEADER_FIELDS, diaryBoxHeightPx, prefilledHeader } from './diary-geometry.js';

/** Typing in one header field within this window is one undo step. */
const HEADER_TYPING_GROUP_MS = 1000;

/** Meta on transactions that edit a diary header. */
export const HEADER_META = 'bpHeader';
/** Meta on page-structure transactions (add/delete page, header toggle). */
export const STRUCTURE_META = 'bpStructure';

function pageIndexOf(view, getPos) {
    const pos = getPos();
    if (typeof pos !== 'number') return { index: 0, count: view.state.doc.childCount };
    return { index: view.state.doc.resolve(pos).index(0), count: view.state.doc.childCount };
}

class PageViewBase {
    constructor(props) {
        this.node = props.node;
        this.view = props.view;
        this.getPos = props.getPos;
    }

    stopEvent(event) {
        return !this.contentDOM.contains(/** @type {Node} */ (event.target));
    }

    ignoreMutation(mutation) {
        if (mutation.type === 'selection') return !this.contentDOM.contains(mutation.target);
        return !this.contentDOM.contains(mutation.target);
    }
}

/** Letter page: A4 card with a "Page N" label. */
export class LetterPageView extends PageViewBase {
    constructor(props) {
        super(props);
        this.dom = document.createElement('section');
        this.dom.className = 'bp-page letter-page';
        const chrome = document.createElement('div');
        chrome.className = 'letter-page-chrome screen-only';
        chrome.contentEditable = 'false';
        this.label = document.createElement('span');
        this.label.className = 'letter-page-label';
        chrome.appendChild(this.label);
        this.contentDOM = document.createElement('div');
        this.contentDOM.className = 'letter-page-body';
        this.dom.append(chrome, this.contentDOM);
        this.render();
    }

    update(node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    render() {
        const { index } = pageIndexOf(this.view, this.getPos);
        this.label.textContent = `Page ${index + 1}`;
    }
}

function fieldValue(el) {
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        return (el.textContent || '').replace(/ /g, ' ');
    }
    return el.value ?? '';
}

function setFieldValue(el, value) {
    const v = value ?? '';
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        if (el.textContent !== v) el.textContent = v;
    } else if (el.value !== v) {
        el.value = v;
    }
}

/**
 * Diary page: header form + two-column table; the body row is contentDOM.
 *
 * @typedef {object} DiaryPageHost
 * @property {(el: HTMLElement) => void} [onAttachField]  Wire transliteration etc.
 * @property {() => void} [onLayoutChange]                Header height changed.
 * @property {(message: string) => boolean} [confirm]
 */
export class DiaryPageView extends PageViewBase {
    /** @param {any} props @param {DiaryPageHost} host */
    constructor(props, host) {
        super(props);
        this.host = host || {};
        /** Last value this view committed per field (to tell undo from typing). */
        this.committed = {};
        /** Previous header commit, for grouping a burst of typing into one undo step. */
        this.lastCommit = null;
        this.boxH = 0;

        const tpl = document.getElementById('diaryPageTemplate');
        if (!(tpl instanceof HTMLTemplateElement)) throw new Error('#diaryPageTemplate is missing');
        const frag = /** @type {DocumentFragment} */ (tpl.content.cloneNode(true));
        this.dom = /** @type {HTMLElement} */ (frag.querySelector('.diary-page'));
        this.dom.classList.add('bp-page');

        this.chrome = this.dom.querySelector('.diary-page-chrome');
        this.headerEl = this.dom.querySelector('.diary-page-header');
        this.titlesRow = this.dom.querySelector('.diary-titles-row');
        this.label = this.dom.querySelector('.diary-page-label');
        this.toggleBtn = this.dom.querySelector('.diary-header-toggle');
        this.deleteBtn = this.dom.querySelector('.diary-page-delete');

        const body = this.dom.querySelector('tr.diary-body-row');
        body.replaceChildren();
        this.contentDOM = body;

        // Non-content regions are not part of the editable document.
        [this.chrome, this.headerEl, this.titlesRow].forEach((el) => { if (el) el.contentEditable = 'false'; });

        /** @type {Map<string, HTMLElement>} */
        this.fields = new Map();
        this.dom.querySelectorAll('[data-field]').forEach((el) => {
            const k = el.getAttribute('data-field');
            if (!HEADER_FIELDS.includes(k)) return;
            el.setAttribute('data-bp-header-field', k);
            this.fields.set(k, /** @type {HTMLElement} */ (el));
            this.wireField(/** @type {HTMLElement} */ (el));
            this.host.onAttachField?.(/** @type {HTMLElement} */ (el));
        });

        // Page buttons must not take focus from the text: the caret stays
        // where it was, and the next keystroke continues there.
        this.chrome?.addEventListener('mousedown', (e) => e.preventDefault());
        this.toggleBtn?.addEventListener('click', () => this.toggleHeader());
        this.deleteBtn?.addEventListener('click', () => this.deletePage());

        this.render();
        // Header height is only measurable once the page is in the document.
        requestAnimationFrame(() => this.refreshBoxHeight());
        document.fonts?.ready?.then(() => this.refreshBoxHeight());
    }

    wireField(el) {
        const isFlow = el.classList.contains('diary-dotted-flow');
        el.addEventListener('input', (e) => {
            if (/** @type {InputEvent} */ (e).isComposing) return;
            this.commit(el);
        });
        el.addEventListener('compositionend', () => this.commit(el));
        el.addEventListener('change', () => this.commit(el));
        if (isFlow) {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') e.preventDefault();
            });
            el.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r?\n+/g, ' ');
                document.execCommand('insertText', false, text);
            });
            el.addEventListener('blur', () => {
                if (!(el.textContent || '').trim()) el.textContent = '';
            });
        }
    }

    commit(el) {
        const k = el.getAttribute('data-field');
        const v = fieldValue(el);
        const fields = this.node.attrs.fields || {};
        if ((fields[k] ?? '') === v) {
            this.refreshBoxHeight();
            return;
        }
        const pos = this.getPos();
        if (typeof pos !== 'number') return;
        this.committed[k] = v;
        const { state } = this.view;
        const tr = state.tr.setNodeAttribute(pos, 'fields', { ...fields, [k]: v });
        tr.setMeta(HEADER_META, true);
        // Attribute steps have no position range, so the history never sees
        // consecutive keystrokes as adjacent. Group them explicitly — only
        // while nothing else has touched the history since the last one.
        const prev = this.lastCommit;
        const now = Date.now();
        if (prev && prev.field === k && now - prev.time < HEADER_TYPING_GROUP_MS && undoDepth(state) === prev.depth) {
            tr.setMeta('appendedTransaction', prev.tr);
        }
        this.view.dispatch(tr);
        this.lastCommit = { field: k, time: now, tr, depth: undoDepth(this.view.state) };
    }

    toggleHeader() {
        const pos = this.getPos();
        if (typeof pos !== 'number') return;
        const { doc } = this.view.state;
        const index = doc.resolve(pos).index(0);
        const turningOn = !this.node.attrs.hasHeader;
        const tr = this.view.state.tr.setNodeAttribute(pos, 'hasHeader', turningOn);
        const fields = this.node.attrs.fields || {};
        const blank = HEADER_FIELDS.every((k) => k === 'rule_no' || !String(fields[k] ?? '').trim());
        if (turningOn && blank && index > 0) {
            const before = [];
            for (let i = 0; i < index; i++) before.push(doc.child(i).attrs);
            tr.setNodeAttribute(pos, 'fields', prefilledHeader(before));
        }
        tr.setMeta(STRUCTURE_META, true);
        this.view.dispatch(tr);
    }

    deletePage() {
        const pos = this.getPos();
        if (typeof pos !== 'number' || this.view.state.doc.childCount <= 1) return;
        const ok = this.host.confirm ? this.host.confirm('Delete this page? You can undo with Ctrl+Z.') : true;
        if (!ok) return;
        const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
        tr.setMeta(STRUCTURE_META, true);
        this.view.dispatch(tr);
    }

    update(node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    render() {
        const { hasHeader, fields = {} } = this.node.attrs;
        const { index, count } = pageIndexOf(this.view, this.getPos);
        this.dom.dataset.hasHeader = hasHeader ? 'true' : 'false';
        if (this.headerEl) this.headerEl.hidden = !hasHeader;
        if (this.titlesRow) this.titlesRow.hidden = !hasHeader;
        if (this.label) this.label.textContent = `Page ${index + 1}`;
        if (this.toggleBtn) {
            this.toggleBtn.textContent = hasHeader ? 'Hide header' : 'Show header';
            this.toggleBtn.setAttribute('aria-pressed', hasHeader ? 'true' : 'false');
            this.toggleBtn.title = hasHeader ? 'Hide page header' : 'Show page header';
        }
        if (this.deleteBtn) this.deleteBtn.hidden = count <= 1;

        const active = document.activeElement;
        for (const [k, el] of this.fields) {
            const v = fields[k] ?? '';
            // Don't overwrite what the user is typing — unless the value moved
            // for another reason (undo/redo), which never matches our commit.
            if (el === active && this.committed[k] === v) continue;
            if (el === active && fieldValue(el) === v) continue;
            setFieldValue(el, v);
            this.committed[k] = v;
        }
        this.refreshBoxHeight();
    }

    /** Size the writing boxes to whatever the header leaves of the page. */
    refreshBoxHeight() {
        const hasHeader = this.node.attrs.hasHeader;
        const headerH = hasHeader && this.headerEl ? this.headerEl.offsetHeight : 0;
        const titlesH = hasHeader && this.titlesRow ? this.titlesRow.offsetHeight : 0;
        const h = diaryBoxHeightPx(hasHeader, headerH || undefined, titlesH || undefined);
        if (h === this.boxH) return;
        this.boxH = h;
        this.dom.style.setProperty('--diary-box-h', `${h}px`);
        this.host.onLayoutChange?.();
    }
}
