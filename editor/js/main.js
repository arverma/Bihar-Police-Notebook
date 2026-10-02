import { getWordBoundaries } from './word-boundaries.js';
import { fetchSuggestions } from './translit.js';
import {
    getDocuments,
    getDocumentById,
    saveDocumentById,
    softDeleteDocument,
    softDeleteDocumentById,
    hardDeleteById,
    previewText,
    backupStatus,
} from './document-store.js';
import { initLetterSheet } from './letter-sheet.js';
import {
    initDiarySheet,
    autoDiaryFilename,
    isAutoDiaryFilename,
    DIARY_NON_TRANSLIT_HEADER_FIELDS,
} from './diary-sheet.js';
import { initDictation } from './dictation-ui.js';
import { initPunctuationPanel } from './punctuation.js';
import {
    initDriveAuth,
    connectDrive,
    disconnectDrive,
    isConnected,
    hasUsableAccessToken,
    ensureAccessToken,
    getConnectedEmail,
    onAuthChange,
} from './drive-auth.js';
import {
    syncAll,
    pushPending,
    onSyncStatusChange,
    getSyncState,
} from './drive-sync.js';
import { initPageScale } from './page-scale.js';
import { initFormatToolbar } from './editor/toolbar.js';
import { isSupportedContent } from './editor/doc-format.js';
import { initUnsupportedDocs } from './unsupported-docs.js';
import { createTestHooks } from './editor/test-hooks.js';
import { pickStartupDocument, newestFirst, historyDate } from './startup-document.js';
import { runDocumentExport } from './export/router.js';

const letterPagesEl = document.getElementById('letterPages');
const suggestionsBox = document.getElementById('suggestions');
const filenameInput = document.getElementById('filenameInput');
const exportBtnEl = document.getElementById('exportBtn');
const filenameWrap = document.querySelector('.filename-resize-wrap');
const filenameSizer = document.querySelector('.filename-sizer');
const formatToolbarEl = document.getElementById('formatToolbar');
/** @type {ReturnType<typeof initFormatToolbar> | null} */
let formatToolbar = null;

/** @type {ReturnType<typeof initPageScale> | null} */
let pageScale = null;

function chromeHeaderHeight() {
    const header = document.querySelector('.header-frame');
    if (header instanceof HTMLElement) {
        return Math.ceil(header.getBoundingClientRect().height);
    }
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome-top')
        .trim();
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 56;
}

function syncChromeTop() {
    const h = chromeHeaderHeight();
    document.documentElement.style.setProperty('--chrome-top', `${h}px`);
}

function syncFilenameWidth() {
    if (!filenameInput || !filenameWrap) return;
    const text = (filenameInput.value || '').trim() || filenameInput.placeholder || 'Document name…';
    let measured = Math.ceil(getTextWidth(text, filenameInput)) + 28;
    if (filenameSizer) {
        filenameSizer.textContent = text;
        const sizerW = Math.ceil(filenameSizer.scrollWidth);
        if (sizerW > 0) measured = Math.max(measured, sizerW + 2);
    }
    const cluster = filenameInput.closest('.doc-name-cluster');
    const maxFromCluster = cluster
        ? Math.max(100, cluster.clientWidth - 4)
        : 420;
    const maxW = Math.min(420, maxFromCluster);
    const width = Math.min(maxW, Math.max(100, measured));
    document.documentElement.style.setProperty('--filename-w', `${width}px`);
    document.documentElement.style.setProperty('--filename-max', `${maxW}px`);
}

/** @type {ReturnType<typeof initLetterSheet> | null} */
let letterSheet = null;

/** @type {ReturnType<typeof initDiarySheet> | null} */
let diarySheet = null;

/** @type {{ id: number|null, type: 'letter'|'diary', createdAt: string }} */
let currentDoc = { id: null, type: 'diary', createdAt: new Date().toISOString() };

let saveTimer = null;
const AUTOSAVE_DELAY_MS = 600;
/** @type {(() => Promise<void>) | null} */
let loadHistoryFn = null;

/** Skip treating the next filename input as a user rename. */
let filenameProgrammatic = false;

/** When true, FIR/date must not overwrite the header filename input. */
let diaryFilenameManual = false;

/** When true, skip Hinglish transliteration (direct Devanagari typing). */
let isHindiMode = false;
const mobileInputMq = window.matchMedia('(max-width: 768px)');

/** Hinglish transliteration is desktop/tablet only — mobile uses the OS keyboard. */
function isTransliterationEnabled() {
    return !isHindiMode && !mobileInputMq.matches;
}

/** When true, skip transliteration suggestions for a programmatic dictated insert. */
let isDictatedInput = false;

/**
 * Last focused editable inside the letter/diary editors (for dictation target).
 * `el` is any editable field type: a document editor root, a contenteditable
 * header field, or an input/textarea.
 * @type {{ el: HTMLElement, start: number, end: number, field?: object } | null}
 */
let dictationTarget = null;

function formatDocFilename(date = new Date()) {
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * @param {string} value
 */
function setFilenameInputProgrammatic(value) {
    if (!filenameInput) return;
    filenameProgrammatic = true;
    filenameInput.value = value;
    updateDocumentTitle();
    syncFilenameWidth();
    requestAnimationFrame(() => {
        filenameProgrammatic = false;
    });
}

function syncDiaryFilenameIfAuto() {
    if (!filenameInput || getActiveTemplate() !== 'diary' || diaryFilenameManual) return;
    const fir = diarySheet?.firNumber() ?? '';
    setFilenameInputProgrammatic(autoDiaryFilename(currentDoc.createdAt, fir));
}

function shouldAttachDiaryTransliteration(el) {
    if (!(el instanceof HTMLElement)) return false;
    const field = el.dataset.field || '';
    if (field && DIARY_NON_TRANSLIT_HEADER_FIELDS.has(field)) return false;
    return Boolean(
        el.matches?.('input:not([type="date"]), textarea, [data-field].diary-dotted-flow')
        || isDocEditor(el),
    );
}

/**
 * @param {HTMLElement|null} btn
 * @param {string} iconClass e.g. "fas fa-cloud-arrow-up" or "fas fa-spinner"
 */
function setBtnIcon(btn, iconClass) {
    const icon = btn?.querySelector('.btn-icon i');
    if (!icon) return;
    icon.className = iconClass;
}

/**
 * Local autosave busy state on the PDF button (spinner = saving, not exporting).
 * @param {'saving'|'saved'} state
 */
function setSaveStatus(state) {
    if (!exportBtnEl) return;
    if (state === 'saving') {
        exportBtnEl.classList.add('is-busy');
        exportBtnEl.setAttribute('aria-busy', 'true');
        exportBtnEl.title = 'Saving…';
        setBtnIcon(exportBtnEl, 'fas fa-spinner');
        return;
    }
    exportBtnEl.classList.remove('is-busy');
    exportBtnEl.removeAttribute('aria-busy');
    exportBtnEl.title = 'Print or save as PDF';
    setBtnIcon(exportBtnEl, 'fas fa-file-pdf');
}

function getActiveTemplate() {
    return document.querySelector('.editor-letter').style.display !== 'none' ? 'letter' : 'diary';
}

function setTemplateSegmentUI(type) {
    document.querySelectorAll('#templateSegment .segment-btn').forEach((btn) => {
        const active = btn.dataset.template === type;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setTranslitToggleUI(translitEnabled) {
    const toggle = document.getElementById('translitToggle');
    if (toggle) {
        toggle.checked = translitEnabled;
    }
    applyEditorPlaceholders();
}

/** Placeholder for the letter's first page (depends on input language mode). */
function letterPlaceholder({ pageIndex }) {
    if (pageIndex !== 0) return '';
    if (mobileInputMq.matches) return 'यहाँ टाइप करें...';
    if (isHindiMode) return 'यहाँ हिंदी में टाइप करें...';
    return 'यहाँ Hinglish में टाइप करें...';
}

/** Placeholder for every empty diary writing box. */
function diaryPlaceholder({ col }) {
    if (mobileInputMq.matches && col === 'left') return 'यहाँ टाइप करें...';
    return 'यहाँ विवरण लिखें...';
}

function applyEditorPlaceholders() {
    letterSheet?.refreshPlaceholders();
    diarySheet?.refreshPlaceholders();
}

function updateDocumentTitle() {
    const name = (filenameInput?.value || '').trim() || formatDocFilename(new Date(currentDoc.createdAt));
    const kind = currentDoc.type === 'diary' ? 'Diary' : 'Letter';
    document.title = `${name} · ${kind} — Bihar Police Notebook`;
}

/** The sheet for the visible template. */
function activeSheet() {
    return getActiveTemplate() === 'letter' ? letterSheet : diarySheet;
}

function getActiveContent() {
    return activeSheet()?.getContent() ?? '';
}

function hasMeaningfulContent() {
    return Boolean(activeSheet()?.hasMeaningfulContent());
}

async function flushSave() {
    saveTimer = null;
    if (!hasMeaningfulContent() && currentDoc.id == null) {
        setSaveStatus('saved');
        return;
    }
    const type = getActiveTemplate();
    if (type === 'diary') syncDiaryFilenameIfAuto();
    const filename = (filenameInput?.value || '').trim() || formatDocFilename(new Date(currentDoc.createdAt));
    if (filenameInput && !filenameInput.value.trim()) filenameInput.value = filename;

    try {
        const id = await saveDocumentById(type, {
            id: currentDoc.id,
            filename,
            content: getActiveContent(),
            created_at: currentDoc.createdAt,
        });
        currentDoc = { id, type, createdAt: currentDoc.createdAt };
        localStorage.setItem('lastActiveDocId', id);
        localStorage.setItem('lastActiveDocType', type);
        setSaveStatus('saved');
        updateDocumentTitle();
        if (loadHistoryFn) await loadHistoryFn();
    } catch (err) {
        console.error('Autosave failed:', err);
        setSaveStatus('saved');
    }
}

function scheduleSave() {
    setSaveStatus('saving');
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flushSave(); }, AUTOSAVE_DELAY_MS);
}

/**
 * Shown instead of opening a document this version cannot open.
 * @type {((doc: object, opts?: { damaged?: boolean }) => void) | null}
 */
let showUnopenableDocument = null;

/**
 * Whether stored content opens in its template's editor.
 * @param {{ type: string, content?: string }} doc
 */
function canOpenDocument(doc) {
    const sheet = doc.type === 'letter' ? letterSheet : diarySheet;
    return Boolean(sheet?.canOpen(doc.content));
}

async function loadDocumentState(doc) {
    if (!canOpenDocument(doc)) {
        showUnopenableDocument?.(doc, { damaged: isSupportedContent(doc.content) });
        return false;
    }
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await flushSave();
    }
    currentDoc = {
        id: doc.id ?? null,
        type: doc.type,
        createdAt: doc.created_at || new Date().toISOString(),
    };
    filenameInput.value = doc.filename;
    
    if (doc.type === 'diary') {
        document.querySelector('.editor-letter').style.display = 'none';
        document.querySelector('.editor-diary').style.display = '';
        setTemplateSegmentUI('diary');
        diarySheet?.setContent(doc.content);
        const fir = diarySheet?.firNumber() ?? '';
        diaryFilenameManual = !isAutoDiaryFilename(
            doc.filename,
            currentDoc.createdAt,
            fir,
        );
    } else {
        diaryFilenameManual = false;
        document.querySelector('.editor-letter').style.display = '';
        document.querySelector('.editor-diary').style.display = 'none';
        setTemplateSegmentUI('letter');
        letterSheet?.setContent(doc.content || '');
        letterSheet?.focus();
    }
    
    setSaveStatus('saved');
    updateDocumentTitle();
    syncFilenameWidth();
    pageScale?.refresh();
    
    if (loadHistoryFn) loadHistoryFn();
    
    if (currentDoc.id) {
        localStorage.setItem('lastActiveDocId', currentDoc.id);
        localStorage.setItem('lastActiveDocType', currentDoc.type);
    } else {
        localStorage.removeItem('lastActiveDocId');
        localStorage.setItem('lastActiveDocType', currentDoc.type);
    }
}

/**
 * On load, reopen the last document; else the top of History; a new document
 * only when there is nothing to open.
 */
async function openStartupDocument() {
    const lastType = localStorage.getItem('lastActiveDocType') === 'letter' ? 'letter' : 'diary';
    const lastId = Number.parseInt(localStorage.getItem('lastActiveDocId') || '', 10);
    try {
        const [lastDoc, historyDocs] = await Promise.all([
            Number.isFinite(lastId) ? getDocumentById(lastType, lastId).catch(() => null) : null,
            getDocuments(lastType),
        ]);
        const pick = pickStartupDocument({ lastType, lastDoc, historyDocs, canOpen: canOpenDocument });
        if ('open' in pick) {
            await loadDocumentState(pick.open);
            return;
        }
    } catch (err) {
        console.error('Failed to restore a document on load:', err);
    }
    await startNewDocument(lastType);
}

async function startNewDocument(type = getActiveTemplate()) {
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await flushSave();
    }
    const createdAt = new Date().toISOString();
    currentDoc = { id: null, type, createdAt };
    localStorage.removeItem('lastActiveDocId');
    localStorage.setItem('lastActiveDocType', type);
    if (filenameInput) filenameInput.value = formatDocFilename(new Date(createdAt));

    if (type === 'letter') {
        document.querySelector('.editor-letter').style.display = '';
        document.querySelector('.editor-diary').style.display = 'none';
        setTemplateSegmentUI('letter');
        letterSheet?.clear();
        letterSheet?.focus();
    } else {
        document.querySelector('.editor-letter').style.display = 'none';
        document.querySelector('.editor-diary').style.display = '';
        setTemplateSegmentUI('diary');
        diarySheet?.clear();
        diaryFilenameManual = false;
    }
    setSaveStatus('saved');
    updateDocumentTitle();
    syncFilenameWidth();
    pageScale?.refresh();
}

async function requestNewDocument(type = getActiveTemplate()) {
    if (hasMeaningfulContent()) {
        const ok = confirm('Start a new document? Current work is already saved in History.');
        if (!ok) return;
    }
    await startNewDocument(type);
}

function switchTemplate(template) {
    if (template !== 'letter' && template !== 'diary') return;
    const current = getActiveTemplate();
    if (current === template && currentDoc.type === template) {
        setTemplateSegmentUI(template);
        return;
    }
    void (async () => {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await flushSave();
        await startNewDocument(template);
        void loadHistoryFn?.();
    })();
}

function getCaretPosition(input, indexOverride) {
    // Create a temporary div to measure text
    const div = document.createElement('div');
    div.style.cssText = window.getComputedStyle(input, null).cssText;
    div.style.height = 'auto';
    div.style.position = 'absolute';
    div.style.whiteSpace = 'pre-wrap';
    div.style.overflowWrap = 'break-word';
    div.style.top = '-9999px';
    div.style.left = '-9999px';
    div.style.opacity = '0';
    div.style.overflow = 'hidden';

    const index = typeof indexOverride === 'number' ? indexOverride : input.selectionStart;
    // Get the text before the cursor
    const textBeforeCursor = input.value.substring(0, index);
    div.textContent = textBeforeCursor;

    // Add a span at the end to measure cursor position
    const span = document.createElement('span');
    span.textContent = '.';
    div.appendChild(span);
    document.body.appendChild(div);

    // Calculate position
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    const position = {
        top: spanRect.top - divRect.top,
        left: spanRect.left - divRect.left
    };

    // Clean up
    document.body.removeChild(div);

    return position;
}

let typingTimer;
const doneTypingInterval = 50; // Reduced delay to 50ms for faster response

/** @param {Element|null|undefined} el */
function isDocEditor(el) {
    return Boolean(el?.classList?.contains('bp-doc'));
}

/**
 * Text field adapter for a document editor root.
 * @param {Element|null|undefined} el
 */
function getFieldForEditor(el) {
    if (!isDocEditor(el)) return null;
    if (letterSheet && el === letterSheet.editor.view.dom) return letterSheet.field;
    if (diarySheet && el === diarySheet.editor.view.dom) return diarySheet.field;
    return null;
}

/**
 * Events on a document editor root also bubble up from the diary header
 * fields and page buttons inside it; those have their own listeners. Body
 * text events target the root itself (it is the editing host).
 * @param {HTMLElement} el editor root
 * @param {EventTarget|null} target
 */
function isForDocText(el, target) {
    if (!isDocEditor(el)) return true;
    return !(target instanceof Element && target.closest('[data-bp-header-field], .diary-page-chrome'));
}

function isEditableTextField(el) {
    return Boolean(
        el
        && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
            || el.getAttribute?.('contenteditable') === 'true'
            || isDocEditor(el)),
    );
}

/** @param {HTMLElement} el */
function getEditableText(el) {
    const field = getFieldForEditor(el);
    if (field) return field.getText();
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        return (el.textContent || '').replace(/\u00a0/g, ' ');
    }
    return el.value || '';
}

/** @param {HTMLElement} el @param {string} text */
function setEditableText(el, text) {
    const field = getFieldForEditor(el);
    if (field) {
        field.replaceRange(0, field.getText().length, text);
        return;
    }
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }
    el.value = text;
    // Diary header inputs commit to the document on `input`.
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Replace a word range without wiping the formatting around it.
 * @param {HTMLElement} el
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
function replaceEditableRange(el, start, end, replacement) {
    const field = getFieldForEditor(el);
    if (field) {
        field.replaceRange(start, end, replacement);
        return;
    }
    const value = getEditableText(el);
    setEditableText(el, value.slice(0, start) + replacement + value.slice(end));
    setEditableCaret(el, start + replacement.length);
}

/** @param {HTMLElement} el */
function getEditableCaret(el) {
    const field = getFieldForEditor(el);
    if (field) return field.getCaret();
    if (!(el.isContentEditable || el.getAttribute?.('contenteditable') === 'true')) {
        return el.selectionStart ?? getEditableText(el).length;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
        return getEditableText(el).length;
    }
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
}

/** @param {HTMLElement} el @param {number} offset */
function setEditableCaret(el, offset) {
    const field = getFieldForEditor(el);
    if (field) {
        field.setCaret(offset);
        return;
    }
    if (!(el.isContentEditable || el.getAttribute?.('contenteditable') === 'true')) {
        el.selectionStart = el.selectionEnd = offset;
        return;
    }
    const text = getEditableText(el);
    const clamped = Math.max(0, Math.min(offset, text.length));
    if (!el.firstChild || el.firstChild.nodeType !== Node.TEXT_NODE) {
        el.textContent = text;
    }
    const textNode = el.firstChild;
    if (!textNode) {
        el.focus();
        return;
    }
    const range = document.createRange();
    const sel = window.getSelection();
    const off = Math.min(clamped, textNode.textContent?.length || 0);
    range.setStart(textNode, off);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/**
 * Selection range in plain-text offsets for any editable field type
 * (document editor, contenteditable, input/textarea). Companion to
 * getEditableCaret, which returns the collapsed caret only.
 * @param {HTMLElement} el
 * @returns {{ start: number, end: number }}
 */
function getEditableSelection(el) {
    const field = getFieldForEditor(el);
    if (field) return field.getSelection();
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        const start = getEditableCaret(el);
        const sel = window.getSelection();
        const len = sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
            ? sel.getRangeAt(0).toString().length
            : 0;
        return { start, end: start + len };
    }
    const len = getEditableText(el).length;
    return { start: el.selectionStart ?? len, end: el.selectionEnd ?? len };
}

function attachTransliteration(el) {
    el.addEventListener('input', function (e) {
        if (!isForDocText(el, e.target)) return;
        if (el.closest('.editor-letter') || el.closest('.editor-diary')) {
            scheduleSave();
        }
        if (!e.isTrusted) {
            return; // Ignore programmatic updates (e.g. after clicking a suggestion)
        }
        if (isDictatedInput) {
            suggestionsBox.style.display = 'none';
            return;
        }
        if (!isTransliterationEnabled()) {
            suggestionsBox.style.display = 'none';
            return;
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(async () => {
            if (!isTransliterationEnabled()) return;
            const value = getEditableText(el);
            const cursor = getEditableCaret(el);
            const [start, end] = getWordBoundaries(value, Math.max(0, cursor - 1));
            const currentWord = value.slice(start, end);

            if (currentWord.trim()) {
                const suggestions = await fetchSuggestions(currentWord);
                if (suggestions && suggestions.length > 0) {
                    showSuggestions(suggestions, start, end, el);
                } else {
                    suggestionsBox.style.display = 'none';
                }
            } else {
                suggestionsBox.style.display = 'none';
            }
        }, doneTypingInterval);
    });

    el.addEventListener('keydown', async function (e) {
        if (e.key !== ' ') return;
        if (!isForDocText(el, e.target)) return;
        if (e.isComposing) return;
        if (!isTransliterationEnabled()) return;
        e.preventDefault();
        const value = getEditableText(el);
        const cursor = getEditableCaret(el);
        const [start, end] = getWordBoundaries(value, cursor - 1);
        const word = value.slice(start, end);

        if (!word.trim()) {
            replaceEditableRange(el, cursor, cursor, ' ');
            return;
        }

        let suggestions = await fetchSuggestions(word);
        suggestionsBox.style.display = 'none';
        if (suggestions && suggestions.length > 0 && suggestions[0] !== word) {
            const suggestion = suggestions[0];
            replaceEditableRange(el, start, end, suggestion + ' ');
        } else {
            replaceEditableRange(el, cursor, cursor, ' ');
        }
    });

    el.addEventListener('click', async function (e) {
        if (!isForDocText(el, e.target)) return;
        if (!isTransliterationEnabled()) return;
        const value = getEditableText(el);
        const cursor = getEditableCaret(el);
        const [start, end] = getWordBoundaries(value, cursor);
        const word = value.slice(start, end);

        if (word.trim()) {
            const suggestions = await fetchSuggestions(word);
            if (suggestions && suggestions.length > 0) {
                showSuggestions(suggestions, start, end, el);
            } else {
                suggestionsBox.style.display = 'none';
            }
        } else {
            suggestionsBox.style.display = 'none';
        }
    });
}

document.addEventListener('click', function (e) {
    const t = e.target;
    if (suggestionsBox.contains(t)) return;
    if (t instanceof HTMLElement && isEditableTextField(t)) return;
    suggestionsBox.style.display = 'none';
});

function showSuggestions(suggestions, wordStart, wordEnd, targetEl) {
    suggestionsBox.innerHTML = '';
    if (!suggestions || suggestions.length === 0 || !targetEl) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const scale = pageScale?.getScale() || 1;
    const inputRect = targetEl.getBoundingClientRect();
    let boxLeft, boxTop;
    /** Top edge of the word's line, for flipping the box above it. */
    let wordTop = inputRect.top;
    const field = getFieldForEditor(targetEl);

    if (field) {
        // Editor coordinates are viewport pixels already (page scale included).
        const rect = field.coordsAt(wordEnd);
        if (!rect) {
            suggestionsBox.style.display = 'none';
            return;
        }
        boxLeft = rect.left;
        boxTop = rect.bottom + 5;
        wordTop = rect.top;
    } else if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
        // Use the hidden div method for textareas to handle soft-wraps
        const pos = getCaretPosition(targetEl, wordEnd);
        const style = window.getComputedStyle(targetEl);
        const lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.2 || 24;
        boxLeft = inputRect.left + (pos.left * scale) - ((targetEl.scrollLeft || 0) * scale);
        boxTop = inputRect.top + (pos.top * scale) + (lineHeight * scale) + 5 - ((targetEl.scrollTop || 0) * scale);
        wordTop = boxTop - lineHeight * scale - 5;
    } else {
        // Fallback for generic contenteditable (naive approach)
        const style = window.getComputedStyle(targetEl);
        const lineHeight = (parseInt(style.lineHeight) || 24) * scale;
        const paddingTop = (parseInt(style.paddingTop) || 0) * scale;
        const paddingLeft = (parseInt(style.paddingLeft) || 0) * scale;
        const value = getEditableText(targetEl);
        const textBeforeWord = value.substring(0, wordStart);
        const lines = textBeforeWord.split('\n').length - 1;
        const currentLineText = textBeforeWord.split('\n').pop();
        const textWidth = getTextWidth(currentLineText, targetEl) * scale;

        boxLeft = inputRect.left + paddingLeft + Math.min(textWidth, Math.max(40 * scale, inputRect.width - paddingLeft - 200 * scale));
        boxTop = inputRect.top + paddingTop + (lines + 1) * lineHeight + 5 - ((targetEl.scrollTop || 0) * scale);
        wordTop = boxTop - lineHeight - 5;
    }

    suggestionsBox.style.position = 'fixed';
    suggestionsBox.style.left = boxLeft + 'px';
    suggestionsBox.style.top = boxTop + 'px';

    suggestions.forEach((suggestion) => {
        const div = document.createElement('div');
        div.className = 'suggestion';
        div.textContent = suggestion;
        div.onclick = () => {
            // Hide first so diary reflow is not skipped by translitOwnsInput().
            suggestionsBox.style.display = 'none';
            replaceEditableRange(targetEl, wordStart, wordEnd, suggestion);
            if (!getFieldForEditor(targetEl)) {
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };
        div.title = `Insert “${suggestion}”`;
        suggestionsBox.appendChild(div);
    });
    suggestionsBox.style.display = 'block';

    const boxRect = suggestionsBox.getBoundingClientRect();
    const headerH = chromeHeaderHeight();
    if (boxRect.right > window.innerWidth) {
        suggestionsBox.style.left = (window.innerWidth - boxRect.width - 10) + 'px';
    }
    if (boxRect.bottom > window.innerHeight) {
        // No room below the word: open above it.
        suggestionsBox.style.top = (wordTop - boxRect.height - 5) + 'px';
    }
    if (parseInt(suggestionsBox.style.top, 10) < headerH) {
        suggestionsBox.style.top = headerH + 'px';
    }
}

// Helper function to calculate text width
function getTextWidth(text, element) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    const style = window.getComputedStyle(element, null);
    const font = style.getPropertyValue('font');
    context.font = font && font !== ''
        ? font
        : `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(text);
    return metrics.width;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Ensure suggestions don't go off-screen
function adjustSuggestionsPosition() {
    if (suggestionsBox.style.display === 'none') return;

    const boxRect = suggestionsBox.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const headerH = chromeHeaderHeight();

    // Adjust horizontal position if off-screen
    if (boxRect.right > viewportWidth) {
        suggestionsBox.style.left = (viewportWidth - boxRect.width - 10) + 'px';
    }

    // Adjust vertical position if off-screen
    if (boxRect.bottom > viewportHeight) {
        suggestionsBox.style.top = (viewportHeight - boxRect.height - 10) + 'px';
    }

    if (parseInt(suggestionsBox.style.top, 10) < headerH) {
        suggestionsBox.style.top = headerH + 'px';
    }
}

// Call adjustSuggestionsPosition after showing suggestions
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.target === suggestionsBox &&
            mutation.type === 'attributes' &&
            mutation.attributeName === 'style') {
            adjustSuggestionsPosition();
            // Pagination waits while suggestions own the word; resume it.
            if (!suggestionsOwnInput()) {
                letterSheet?.resumePagination();
                diarySheet?.resumePagination();
            }
        }
    });
});

if (suggestionsBox) {
    observer.observe(suggestionsBox, { attributes: true });
}

/** The suggestion box is open, so the word being typed is not final yet. */
function suggestionsOwnInput() {
    if (!suggestionsBox || suggestionsBox.hidden || suggestionsBox.style.display === 'none') return false;
    return suggestionsBox.childElementCount > 0;
}

function initApp() {
    initPunctuationPanel();
    const addTemplateBtn = document.querySelector('.add-template-btn');
    const exportBtn = document.getElementById('exportBtn');
    const historyList = document.querySelector('.history-list');
    const backupBtn = document.getElementById('backupBtn');
    const driveEmailLabel = document.getElementById('driveEmailLabel');
    const driveMenu = document.getElementById('driveMenu');
    const driveSyncNowBtn = document.getElementById('driveSyncNowBtn');
    const driveSyncNewBtn = document.getElementById('driveSyncNewBtn');
    const driveDisconnectBtn = document.getElementById('driveDisconnectBtn');

    function setBackupBusy(busy) {
        if (!backupBtn) return;
        const glyph = backupBtn.querySelector('.backup-glyph');
        const spinner = backupBtn.querySelector('.backup-spinner');
        if (glyph) glyph.hidden = Boolean(busy);
        if (spinner) spinner.hidden = !busy;
    }

    /**
     * @param {'needs-auth'|'ready'|'syncing'|'error'} state
     * @param {string} [errorMsg]
     */
    function setBackupUiState(state, errorMsg) {
        if (!backupBtn) return;
        const prev = backupBtn.dataset.backup;
        backupBtn.dataset.backup = state;
        const email = getConnectedEmail();
        const emailBit = email ? ` (${email})` : '';

        if (state === 'syncing') {
            backupBtn.classList.remove('is-sync-success');
            backupBtn.classList.add('is-busy');
            backupBtn.setAttribute('aria-busy', 'true');
            setBackupBusy(true);
            backupBtn.title = `Syncing…${emailBit}`;
            backupBtn.setAttribute('aria-label', 'Syncing backup');
            return;
        }

        backupBtn.classList.remove('is-busy');
        backupBtn.removeAttribute('aria-busy');
        setBackupBusy(false);

        if (state === 'needs-auth') {
            backupBtn.classList.remove('is-sync-success');
            backupBtn.title = 'Connect to back up';
            backupBtn.setAttribute('aria-label', 'Connect to back up');
            backupBtn.setAttribute('aria-expanded', 'false');
            if (driveMenu) driveMenu.hidden = true;
        } else if (state === 'error') {
            backupBtn.classList.remove('is-sync-success');
            backupBtn.title = errorMsg
                ? `Backup error — click to retry: ${errorMsg}`
                : 'Backup error — click to retry';
            backupBtn.setAttribute('aria-label', 'Backup error — click to retry');
        } else {
            backupBtn.title = email
                ? `Backup connected as ${email}`
                : 'Backup connected';
            backupBtn.setAttribute(
                'aria-label',
                email ? `Backup connected as ${email}` : 'Backup connected',
            );
            if (prev === 'syncing') {
                backupBtn.classList.remove('is-sync-success');
                // Retrigger success pulse after a completed sync.
                void backupBtn.offsetWidth;
                backupBtn.classList.add('is-sync-success');
                window.setTimeout(() => {
                    backupBtn.classList.remove('is-sync-success');
                }, 600);
            }
        }
    }

    async function updateDriveChrome() {
        const usable = await hasUsableAccessToken();
        const email = getConnectedEmail();

        if (driveEmailLabel) {
            if (email && usable) {
                driveEmailLabel.hidden = false;
                driveEmailLabel.textContent = email;
            } else {
                driveEmailLabel.hidden = true;
                driveEmailLabel.textContent = '';
            }
        }

        if (!usable) {
            if (driveMenu) driveMenu.hidden = true;
            backupBtn?.setAttribute('aria-expanded', 'false');
            const { state, error } = getSyncState();
            if (state === 'error') {
                setBackupUiState('error', error || undefined);
            } else {
                setBackupUiState('needs-auth');
            }
            return;
        }

        updateDriveSyncStatus();
    }

    function updateDriveSyncStatus() {
        if (!backupBtn) return;
        void hasUsableAccessToken().then((usable) => {
            if (!usable) {
                setBackupUiState('needs-auth');
                return;
            }
            const { state, error } = getSyncState();
            if (state === 'syncing') {
                setBackupUiState('syncing');
            } else if (state === 'error') {
                setBackupUiState('error', error || undefined);
            } else {
                setBackupUiState('ready');
            }
        });
    }

    function closeDriveMenu() {
        if (driveMenu) driveMenu.hidden = true;
        backupBtn?.setAttribute('aria-expanded', 'false');
    }

    async function connectAndSync() {
        try {
            setBackupUiState('syncing');
            await connectDrive();
            showNotification('Backup connected.');
            const result = await syncAll();
            if (!result.ok && result.error) {
                setBackupUiState('error', result.error);
                showNotification('Connected, but sync had an error.');
            } else {
                setBackupUiState('ready');
                showNotification('Synced with Drive.');
            }
            await updateDriveChrome();
            await loadHistory();
        } catch (err) {
            console.error(err);
            setBackupUiState('error', err?.message || undefined);
            showNotification(err?.message || 'Could not connect backup.');
        }
    }

    // Helper to get today's date string
    function getDateString(date) {
        const today = new Date();
        if (
            date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear()
        ) return 'Today';
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (
            date.getDate() === yesterday.getDate() &&
            date.getMonth() === yesterday.getMonth() &&
            date.getFullYear() === yesterday.getFullYear()
        ) return 'Yesterday';
        return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    /** @type {ReturnType<typeof initUnsupportedDocs> | null} */
    let unsupportedDocs = null;

    /**
     * Delete a document from History: tombstone for Drive sync, or a purge
     * when it was never backed up.
     * @param {object} doc
     * @param {{ purgeContent?: boolean }} [opts]
     */
    async function deleteDocumentRow(doc, opts = {}) {
        const row = doc.id != null
            ? await softDeleteDocumentById(doc.type, doc.id, opts)
            : await softDeleteDocument(doc.type, doc.filename);
        if (!row) return null;
        if (currentDoc.id != null && currentDoc.id === doc.id) {
            await startNewDocument(doc.type);
        }
        if (!isConnected() && !row.driveFileId) {
            // Never synced — purge locally; no Drive tombstone needed
            await hardDeleteById(row.type, row.id);
        }
        // Drive tombstones upload on next manual Sync all / backup click
        return row;
    }

    // Render history in sidebar
    function snapshotExpandedHistoryGroups() {
        const expanded = new Set();
        historyList?.querySelectorAll('.history-date-group').forEach((group) => {
            const key = group.dataset.dateKey;
            const container = group.querySelector('.history-items-container');
            if (key && container && !container.classList.contains('collapsed')) {
                expanded.add(key);
            }
        });
        return expanded;
    }

    function renderHistory(unsorted = []) {
        // Same order the app opens "the top of History" in on load.
        const docs = newestFirst(unsorted);
        const hadGroups = Boolean(historyList?.querySelector('.history-date-group'));
        const expandedSnapshot = hadGroups ? snapshotExpandedHistoryGroups() : null;

        historyList.innerHTML = '';

        if (!docs.length) {
            const empty = document.createElement('div');
            empty.className = 'history-empty';
            const kind = getActiveTemplate() === 'diary' ? 'diaries' : 'letters';
            empty.innerHTML = `<strong>No ${kind} yet</strong><span>Create one with the + button above.</span>`;
            historyList.appendChild(empty);
            return;
        }

        const groups = {};
        docs.forEach(doc => {
            const dateObj = historyDate(doc);
            const dateKey = getDateString(dateObj);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push({ ...doc, date: dateObj });
        });

        const sortedDateKeys = Object.keys(groups).sort((a, b) => {
            return groups[b][0].date - groups[a][0].date;
        });

        sortedDateKeys.forEach((dateKey, groupIndex) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'history-date-group';
            groupDiv.dataset.dateKey = dateKey;

            const groupHasActiveDoc = groups[dateKey].some(
                (d) => currentDoc.id != null && d.id === currentDoc.id,
            );
            const shouldExpand = expandedSnapshot !== null
                ? (expandedSnapshot.has(dateKey) || groupHasActiveDoc)
                : groupIndex === 0;

            const header = document.createElement('div');
            header.className = 'date-header collapsible-header';
            header.title = 'Expand or collapse this day';
            header.innerHTML = `<span class="collapse-arrow">${shouldExpand ? '&#9660;' : '&#9654;'}</span> ${dateKey}`;
            groupDiv.appendChild(header);

            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'history-items-container';
            if (!shouldExpand) itemsContainer.classList.add('collapsed');

            const listType = getActiveTemplate();
            groups[dateKey].sort((a, b) => b.date - a.date).forEach(doc => {
                const supported = isSupportedContent(doc.content);
                const firstLine = supported && listType === 'letter' ? previewText(doc) : '';
                const created = new Date(doc.created_at || doc.date || Date.now());
                const updated = doc.updated_at ? new Date(doc.updated_at) : created;
                const updatedStr = updated.toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                });

                const status = backupStatus(doc);
                const connected = isConnected();
                let leadingIcon = '';
                if (connected) {
                    if (status === 'synced') {
                        leadingIcon = `<span class="history-sync-badge is-synced" title="Backed up to Drive"><i class="fas fa-cloud" aria-hidden="true"></i></span>`;
                    } else if (status === 'error') {
                        leadingIcon = `<span class="history-sync-badge is-error" title="${escapeHtml(doc.syncError || 'Backup failed')}"><i class="fas fa-cloud" aria-hidden="true"></i></span>`;
                    } else {
                        leadingIcon = `<span class="history-sync-badge is-pending" title="Not backed up yet"><i class="fas fa-cloud" aria-hidden="true"></i></span>`;
                    }
                }

                const item = document.createElement('div');
                item.className = 'history-item';
                item.tabIndex = 0;
                item.setAttribute('role', 'button');
                item.title = supported ? 'Open this document' : 'Older format — cannot be opened';
                if (!supported) item.dataset.unsupported = 'true';
                if (currentDoc.id != null && doc.id === currentDoc.id) {
                    item.classList.add('is-active');
                }
                const previewHtml = supported
                    ? (firstLine ? `<span class="history-item-preview">${escapeHtml(firstLine)}</span>` : '')
                    : '<span class="history-item-badge">Older format</span>';
                item.innerHTML = `
                    ${leadingIcon}
                    <div class="history-item-details">
                        <span class="history-item-name">${escapeHtml(doc.filename)}</span>
                        <span class="history-item-time" title="Last updated">${updatedStr}</span>
                        ${previewHtml}
                    </div>
                    <div class="history-item-actions">
                        <button class="delete-btn" type="button" title="Delete this document" aria-label="Delete this document"><i class="fas fa-trash"></i></button>
                    </div>
                `;

                const openItem = async () => {
                    if (!supported) {
                        await unsupportedDocs?.open(doc, item);
                        return;
                    }
                    await loadDocumentState(doc);
                };
                item.addEventListener('click', async (e) => {
                    if (e.target.closest('.delete-btn')) return;
                    await openItem();
                });
                item.addEventListener('keydown', async (e) => {
                    if (e.target !== item || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    await openItem();
                });

                item.querySelector('.delete-btn').onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete "${doc.filename}" permanently? This cannot be undone.`)) return;
                    const row = await deleteDocumentRow(doc, { purgeContent: !supported });
                    if (!row) { alert('Failed to delete document.'); return; }
                    showNotification('Document deleted.');
                    await loadHistory();
                };

                itemsContainer.appendChild(item);
            });

            groupDiv.appendChild(itemsContainer);

            header.addEventListener('click', function () {
                itemsContainer.classList.toggle('collapsed');
                const arrow = header.querySelector('.collapse-arrow');
                arrow.innerHTML = itemsContainer.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
            });

            historyList.appendChild(groupDiv);
        });
    }

    async function loadHistory() {
        try {
            const type = getActiveTemplate();
            const docs = await getDocuments(type);
            const title = document.querySelector('.sidebar-header h3');
            if (title) title.textContent = type === 'diary' ? 'Diary History' : 'Letter History';
            renderHistory(docs);
        } catch (err) {
            console.error('Failed to load history:', err);
        }
    }
    loadHistoryFn = loadHistory;

    showUnopenableDocument = (doc, opts) => { void unsupportedDocs?.open(doc, null, opts); };
    unsupportedDocs = initUnsupportedDocs({
        listAll: async () => [...await getDocuments('letter'), ...await getDocuments('diary')],
        deleteDoc: async (doc) => { await deleteDocumentRow(doc, { purgeContent: true }); },
        afterChange: loadHistory,
        notify: showNotification,
    });

    if (letterPagesEl) {
        letterSheet = initLetterSheet(letterPagesEl, {
            onChange: scheduleSave,
            onAttachField: (el) => {
                attachTransliteration(el);
            },
            isHeld: suggestionsOwnInput,
            placeholder: letterPlaceholder,
            // The scaled stage's height follows the number of pages.
            onPageCountChange: () => pageScale?.refresh(),
            onSpill: ({ toPage }) => {
                showNotification(`Continued on page ${toPage}`);
            },
        });
        // Test/dev hooks — same pattern as window.__bpExportMode
        if (typeof window !== 'undefined') {
            window.__bpLetterSheet = letterSheet;
        }
    }

    const diaryPagesEl = document.getElementById('diaryPages');
    if (diaryPagesEl) {
        diarySheet = initDiarySheet(diaryPagesEl, {
            isHeld: suggestionsOwnInput,
            placeholder: diaryPlaceholder,
            onChange: () => {
                syncDiaryFilenameIfAuto();
                scheduleSave();
            },
            onAttachField: (el) => {
                if (shouldAttachDiaryTransliteration(el)) {
                    attachTransliteration(el);
                }
                if (el.type === 'date') {
                    el.addEventListener('change', scheduleSave);
                }
            },
            // The scaled stage's height follows the number of pages.
            onPageCountChange: () => pageScale?.refresh(),
            onSpill: ({ toPage }) => {
                showNotification(`Continued on page ${toPage}`);
            },
        });
        if (typeof window !== 'undefined') {
            window.__bpDiarySheet = diarySheet;
        }
    }

    // Editor modules report user-facing problems (e.g. an unreadable image) as events.
    document.addEventListener('bp:notify', (e) => {
        const message = /** @type {CustomEvent} */ (e).detail?.message;
        if (message) showNotification(message);
    });

    if (formatToolbarEl) {
        formatToolbar = initFormatToolbar(formatToolbarEl, () => activeSheet()?.editor ?? null);
        const syncToolbar = () => formatToolbar?.sync();
        for (const sheet of [letterSheet, diarySheet]) {
            sheet?.editor.on('selectionUpdate', syncToolbar);
            sheet?.editor.on('transaction', syncToolbar);
            sheet?.editor.on('focus', syncToolbar);
            sheet?.editor.on('blur', syncToolbar);
        }
    }

    void openStartupDocument();

    void loadHistory();
    void updateDriveChrome();
    void unsupportedDocs.checkOnLaunch();

    void (async () => {
        try {
            await initDriveAuth();
            await updateDriveChrome();
            // No automatic sync — user clicks the backup icon when they want to sync.
        } catch (err) {
            console.warn('Drive auth init failed:', err);
        }
    })();

    onAuthChange(() => {
        void updateDriveChrome();
        void loadHistory();
    });
    onSyncStatusChange(() => {
        updateDriveSyncStatus();
        void loadHistory();
    });

    backupBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const state = backupBtn.dataset.backup;
        if (state === 'syncing') return;

        if (state === 'needs-auth' || state === 'error') {
            closeDriveMenu();
            await connectAndSync();
            return;
        }

        // ready — toggle menu
        if (!driveMenu) return;
        const open = driveMenu.hidden;
        driveMenu.hidden = !open;
        backupBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    driveSyncNowBtn?.addEventListener('click', async () => {
        closeDriveMenu();
        const token = await ensureAccessToken({ allowInteractive: true });
        if (!token) {
            setBackupUiState('needs-auth');
            showNotification('Connect backup to sync.');
            return;
        }
        const result = await syncAll();
        await loadHistory();
        updateDriveSyncStatus();
        showNotification(result.ok ? 'Synced with Drive.' : (result.error || 'Sync failed.'));
    });

    driveSyncNewBtn?.addEventListener('click', async () => {
        closeDriveMenu();
        const token = await ensureAccessToken({ allowInteractive: true });
        if (!token) {
            setBackupUiState('needs-auth');
            showNotification('Connect backup to sync.');
            return;
        }
        const result = await pushPending();
        await loadHistory();
        updateDriveSyncStatus();
        if (!result.ok) {
            showNotification(result.error || 'Upload failed.');
            return;
        }
        const n = result.count || 0;
        showNotification(
            n === 0
                ? 'No pending changes to upload.'
                : n === 1
                    ? 'Uploaded 1 pending change.'
                    : `Uploaded ${n} pending changes.`,
        );
    });

    driveDisconnectBtn?.addEventListener('click', async () => {
        closeDriveMenu();
        await disconnectDrive();
        await updateDriveChrome();
        await loadHistory();
        showNotification('Backup disconnected. Local files are unchanged.');
    });

    document.addEventListener('click', (e) => {
        if (!driveMenu || driveMenu.hidden) return;
        if (driveControlContains(e.target)) return;
        closeDriveMenu();
    });

    function driveControlContains(target) {
        const root = document.getElementById('driveControl');
        return Boolean(root && target instanceof Node && root.contains(target));
    }

    filenameInput?.addEventListener('change', () => {
        if (!filenameProgrammatic && getActiveTemplate() === 'diary') {
            diaryFilenameManual = true;
        }
        scheduleSave();
        updateDocumentTitle();
        syncFilenameWidth();
    });
    filenameInput?.addEventListener('blur', () => {
        if (!(filenameInput.value || '').trim()) {
            if (getActiveTemplate() === 'diary') {
                const fir = diarySheet?.firNumber() ?? '';
                setFilenameInputProgrammatic(autoDiaryFilename(currentDoc.createdAt, fir));
                diaryFilenameManual = false;
            } else {
                setFilenameInputProgrammatic(formatDocFilename(new Date(currentDoc.createdAt)));
            }
        }
        scheduleSave();
        updateDocumentTitle();
        syncFilenameWidth();
    });
    filenameInput?.addEventListener('input', () => {
        if (filenameProgrammatic) return;
        if (getActiveTemplate() === 'diary') {
            diaryFilenameManual = true;
        }
        updateDocumentTitle();
        syncFilenameWidth();
    });
    syncFilenameWidth();
    syncChromeTop();
    window.addEventListener('resize', () => {
        syncFilenameWidth();
        syncChromeTop();
    });
    if (typeof ResizeObserver !== 'undefined') {
        const header = document.querySelector('.header-frame');
        if (header) {
            new ResizeObserver(() => syncChromeTop()).observe(header);
        }
    }

    async function handleDocumentExport() {
        const activeTemplate = getActiveTemplate() === 'letter' ? 'letter' : 'diary';
        // Print clones the live pages, so let pagination finish first.
        await activeSheet()?.settle();

        const filename = (filenameInput?.value || '').trim()
            || formatDocFilename(new Date(currentDoc.createdAt));
        // Optional test/dev override: window.__bpExportMode = 'raster-pdf' | 'native-print'
        const modeOverride = typeof window !== 'undefined' && window.__bpExportMode
            ? window.__bpExportMode
            : null;
        await runDocumentExport({
            template: activeTemplate,
            filename,
            mode: modeOverride === 'raster-pdf' || modeOverride === 'native-print'
                ? modeOverride
                : null,
        });
    }

    exportBtn?.addEventListener('click', () => { void handleDocumentExport(); });

    const switchBtn = document.querySelector('.switch-btn');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    let isToggled = false;

    function setSidebarOpen(open) {
        isToggled = open;
        switchBtn?.classList.toggle('active', open);
        switchBtn?.setAttribute('aria-pressed', open ? 'true' : 'false');
        const label = open ? 'Hide document history' : 'Show document history';
        switchBtn?.setAttribute('aria-label', label);
        switchBtn?.setAttribute('title', label);
        sidebar?.classList.toggle('open', open);
        sidebar?.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.classList.toggle('sidebar-open', open);
        // Do not shift main content with .shifted — layout-shell handles subtle recenter.
        mainContent?.classList.remove('shifted');
        localStorage.setItem('historySidebarOpen', open ? '1' : '0');
    }

    const initialSidebarState = localStorage.getItem('historySidebarOpen') === '1';
    if (initialSidebarState) {
        setSidebarOpen(true);
    }

    switchBtn?.addEventListener('click', function (e) {
        e.stopPropagation();
        setSidebarOpen(!isToggled);
    });

    // Close history sidebar when clicking outside
    document.addEventListener('click', function (e) {
        if (isToggled && sidebar && !sidebar.contains(e.target) && switchBtn && !switchBtn.contains(e.target)) {
            setSidebarOpen(false);
        }
    });
    pageScale = initPageScale();

    document.querySelectorAll('#templateSegment .segment-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            switchTemplate(btn.dataset.template);
        });
    });

    const toggle = document.getElementById('translitToggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            isHindiMode = !e.target.checked;
            localStorage.setItem('langMode', isHindiMode ? 'hindi' : 'hinglish');
            suggestionsBox.style.display = 'none';
            applyEditorPlaceholders();
        });
    }
    const savedLang = localStorage.getItem('langMode') === 'hindi';
    isHindiMode = savedLang;
    setTranslitToggleUI(!savedLang);

    function onMobileInputModeChange() {
        if (mobileInputMq.matches && suggestionsBox) {
            suggestionsBox.style.display = 'none';
        }
        applyEditorPlaceholders();
        syncChromeTop();
        pageScale?.refresh();
    }
    if (typeof mobileInputMq.addEventListener === 'function') {
        mobileInputMq.addEventListener('change', onMobileInputModeChange);
    }
    onMobileInputModeChange();

    addTemplateBtn?.addEventListener('click', function () {
        requestNewDocument(getActiveTemplate());
    });

    document.addEventListener('keydown', (e) => {
        const meta = e.metaKey || e.ctrlKey;
        const tag = (e.target && e.target.tagName) || '';
        const typing = tag === 'INPUT' || tag === 'TEXTAREA';

        if (e.key === 'Escape') {
            // Dictation Esc is handled in capture phase by dictation-ui.
            // History stays open unless the panel toggle is used.
            return;
        }

        if (!meta) return;

        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            void handleDocumentExport();
            return;
        }
        if (e.key === 'n' || e.key === 'N') {
            if (typing && tag === 'INPUT' && e.target === filenameInput) return;
            e.preventDefault();
            requestNewDocument(getActiveTemplate());
            return;
        }
        if (e.key === 'h' || e.key === 'H' || e.key === 'b' || e.key === 'B') {
            if (typing) return;
            e.preventDefault();
            setSidebarOpen(!isToggled);
        }
    }, false);

    /**
     * Document-level undo/redo — capture before the editor's and inputs'
     * native handlers, so header inputs and body text share one history.
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isEditorUndoTarget(target) {
        if (!(target instanceof Element)) return false;
        if (target === filenameInput || filenameInput?.contains(target)) return false;
        if (target.closest('.history-sidebar')) return false;
        if (target.closest('.dictation-panel') || target.closest('#dictationBar')) return false;
        if (target.closest('.punctuation-panel')) return false;
        if (target.closest('#formatToolbar')) return true;
        if (target.closest('.editor-diary') || target.closest('.editor-letter')) return true;
        return false;
    }

    /**
     * @returns {{ undo: () => boolean, redo: () => boolean } | null}
     */
    function activeSheetHistory() {
        const type = getActiveTemplate();
        if (type === 'diary' && diarySheet) return diarySheet;
        if (type === 'letter' && letterSheet) return letterSheet;
        return null;
    }

    document.addEventListener('keydown', (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (!isEditorUndoTarget(e.target)) return;
        const sheet = activeSheetHistory();
        if (!sheet) return;

        const key = e.key;
        const isUndo = (key === 'z' || key === 'Z') && !e.shiftKey;
        const isRedo = ((key === 'z' || key === 'Z') && e.shiftKey)
            || (key === 'y' || key === 'Y');
        if (!isUndo && !isRedo) return;

        e.preventDefault();
        e.stopPropagation();
        if (isUndo) sheet.undo();
        else sheet.redo();
    }, true);

    document.addEventListener('beforeinput', (e) => {
        if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
        if (!isEditorUndoTarget(e.target)) return;
        const sheet = activeSheetHistory();
        if (!sheet) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.inputType === 'historyUndo') sheet.undo();
        else sheet.redo();
    }, true);

    // Track focus/selection for voice dictation insertion target
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el === filenameInput) return;
        if (!(el instanceof HTMLElement)) return;
        if (!el.closest('.editor-letter') && !el.closest('.editor-diary')) return;

        const field = getFieldForEditor(el);
        if (field) {
            dictationTarget = { el, field, ...field.getSelection() };
            return;
        }

        if (isDictatableContentEditable(el)) {
            dictationTarget = { el, ...getEditableSelection(el) };
            return;
        }

        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        if (el.type === 'date') return;
        dictationTarget = {
            el,
            start: el.selectionStart ?? el.value.length,
            end: el.selectionEnd ?? el.value.length,
        };
    });
    document.addEventListener('selectionchange', () => {
        const el = document.activeElement;
        const docField = getFieldForEditor(el);
        if (docField && dictationTarget?.el === el) {
            Object.assign(dictationTarget, docField.getSelection(), { field: docField });
            return;
        }
        if (isDictatableContentEditable(el) && dictationTarget?.el === el) {
            const sel = getEditableSelection(el);
            dictationTarget.start = sel.start;
            dictationTarget.end = sel.end;
            return;
        }

        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        if (!dictationTarget || dictationTarget.el !== el) return;
        dictationTarget.start = el.selectionStart ?? el.value.length;
        dictationTarget.end = el.selectionEnd ?? el.value.length;
    });

    initDictation({
        getTarget: getDictationTarget,
        insertText: insertDictatedText,
        notify: showNotification,
    });

    // Test/dev hooks — same pattern as window.__bpExportMode
    if (typeof window !== 'undefined') {
        window.__bpDictation = {
            getTarget: getDictationTarget,
            insertText: insertDictatedText,
        };
    }

    window.__bpTest = createTestHooks({ letter: letterSheet, diary: diarySheet, active: activeSheet });
    window.__uxInitComplete = true;
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Show notification message
function showNotification(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'restore-message';
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.classList.add('fade-out');
        setTimeout(() => document.body.removeChild(messageDiv), 500);
    }, 2000);
}

/**
 * Plain contenteditable fields (diary header धारा / घटना की तिथि और स्थान).
 * Document editor roots are contenteditable too, but route through their field.
 * @param {Element|null} el
 */
function isDictatableContentEditable(el) {
    return Boolean(
        el instanceof HTMLElement
        && el.isContentEditable
        && !isDocEditor(el)
        && (el.closest('.editor-letter') || el.closest('.editor-diary')),
    );
}

/**
 * Resolve the current dictation insertion target (caret + element).
 * Falls back to the letter editor when nothing is tracked.
 * @returns {{ el: HTMLElement, start: number, end: number, field?: object } | null}
 */
function getDictationTarget() {
    const active = document.activeElement;

    const activeField = getFieldForEditor(active);
    if (activeField) {
        dictationTarget = { el: active, field: activeField, ...activeField.getSelection() };
        return dictationTarget;
    }

    if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        active !== filenameInput &&
        (active.closest('.editor-letter') || active.closest('.editor-diary')) &&
        active.type !== 'date'
    ) {
        dictationTarget = {
            el: active,
            start: active.selectionStart ?? active.value.length,
            end: active.selectionEnd ?? active.value.length,
        };
        return dictationTarget;
    }

    if (isDictatableContentEditable(active)) {
        dictationTarget = { el: active, ...getEditableSelection(active) };
        return dictationTarget;
    }

    if (dictationTarget?.el?.isConnected) {
        return dictationTarget;
    }

    if (getActiveTemplate() === 'letter') {
        const fieldInfo = letterSheet?.getActiveField();
        if (fieldInfo?.el) {
            fieldInfo.field.focus();
            dictationTarget = fieldInfo;
            return dictationTarget;
        }
    }

    return null;
}

/**
 * Insert finalized dictated text at the tracked caret and fire input
 * so autosave / page layout / diary spill all run as usual.
 * @param {string} text
 */
function insertDictatedText(text) {
    if (!text) return;
    const target = getDictationTarget();
    if (!target?.el) return;

    const el = target.el;
    isDictatedInput = true;
    try {
        const docField = target.field || getFieldForEditor(el);
        if (docField) {
            // The editor keeps its selection while the dictation UI has focus,
            // so insert there (it also follows any reflow since tracking).
            docField.focus();
            docField.insertAtCaret(text);
            dictationTarget = { el: docField.el, field: docField, ...docField.getSelection() };
            return;
        }

        if (isDictatableContentEditable(el)) {
            const value = getEditableText(el);
            const start = Math.min(target.start ?? value.length, value.length);
            const end = Math.min(Math.max(target.end ?? start, start), value.length);
            el.focus();
            // Shared helper: replaces the range, moves the caret and fires `input`,
            // so the header persists + reflows exactly as it does for typing.
            replaceEditableRange(el, start, end, text);
            const caret = start + text.length;
            dictationTarget = { el, start: caret, end: caret };
            return;
        }

        const start = target.start ?? el.selectionStart ?? el.value.length;
        const end = target.end ?? el.selectionEnd ?? el.value.length;
        const value = el.value;
        const next = value.slice(0, start) + text + value.slice(end);
        const caret = start + text.length;
        el.value = next;
        el.focus();
        el.selectionStart = el.selectionEnd = caret;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        dictationTarget = { el, start: caret, end: caret };
    } finally {
        isDictatedInput = false;
    }

    // Inserting may move focus — adopt the now-active field.
    const active = document.activeElement;
    const activeField = getFieldForEditor(active);
    if (activeField) {
        dictationTarget = { el: active, field: activeField, ...activeField.getSelection() };
    } else if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        (active.closest('.editor-letter') || active.closest('.editor-diary'))
    ) {
        dictationTarget = {
            el: active,
            start: active.selectionStart ?? active.value.length,
            end: active.selectionEnd ?? active.value.length,
        };
    }
}

// Retain focus on editor when clicking header or sidebar controls
let lastFocusedForRestore = null;

document.addEventListener('mousedown', (e) => {
    const target = e.target;
    const inHeaderOrSidebar = target.closest('.header-frame') || target.closest('.history-sidebar') || target.closest('.punctuation-panel') || target.closest('.punctuation-toggle');
    const isTextInput = target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea');
    
    if (inHeaderOrSidebar && !isTextInput) {
        const active = document.activeElement;
        // Any editable field type, including the diary's contenteditable
        // header fields (धारा / घटना की तिथि और स्थान).
        const isEditorFocused = Boolean(
            active
            && isEditableTextField(active)
            && (isDocEditor(active) || active.closest('.app-body')),
        );

        if (isEditorFocused) {
            console.log("BP-WritingTool: Retaining focus on mousedown");
            e.preventDefault();
            lastFocusedForRestore = active;
        }
    }
});

document.addEventListener('click', (e) => {
    if (lastFocusedForRestore) {
        // Use a short timeout because label clicks natively transfer focus to inputs AFTER the click event
        setTimeout(() => {
            if (lastFocusedForRestore && typeof lastFocusedForRestore.focus === 'function') {
                console.log("BP-WritingTool: Restoring focus after click");
                lastFocusedForRestore.focus();
            }
            lastFocusedForRestore = null;
        }, 10);
    }
});
