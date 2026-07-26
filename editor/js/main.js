import { getWordBoundaries } from './utils.js';
import { fetchSuggestions } from './translit.js';
import { getDocuments, saveDocumentById, deleteDocument, previewText } from './store.js';
import { initPagedSheet, letterPrintCss, letterPagesHtml } from './paged-sheet.js';
import {
    initDiarySheet,
    diaryPrintCss,
    diaryPagesHtml,
    diaryHasMeaningfulContent,
    emptyModel,
} from './diary-sheet.js';
import { initDictation } from './dictation-ui.js';

const letterPagesEl = document.getElementById('letterPages');
const suggestionsBox = document.getElementById('suggestions');
const pageIndicator = document.getElementById('pageIndicator');
const filenameInput = document.getElementById('filenameInput');
const saveStatusEl = document.getElementById('save-status');

/** @type {ReturnType<typeof initPagedSheet> | null} */
let letterSheet = null;

/** @type {ReturnType<typeof initDiarySheet> | null} */
let diarySheet = null;

/** @type {{ id: number|null, type: 'letter'|'diary', createdAt: string }} */
let currentDoc = { id: null, type: 'diary', createdAt: new Date().toISOString() };

let saveTimer = null;
const AUTOSAVE_DELAY_MS = 600;
/** @type {(() => Promise<void>) | null} */
let loadHistoryFn = null;

/** When true, skip Hinglish transliteration (direct Devanagari typing). */
let isHindiMode = false;

/** When true, skip transliteration suggestions for a programmatic dictated insert. */
let isDictatedInput = false;

/**
 * Last focused editable inside the letter/diary editors (for dictation target).
 * @type {{ el: HTMLInputElement|HTMLTextAreaElement, start: number, end: number } | null}
 */
let dictationTarget = null;

function formatDocFilename(date = new Date()) {
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function setSaveStatus(state) {
    if (!saveStatusEl) return;
    saveStatusEl.dataset.state = state;
    saveStatusEl.textContent = state === 'saving' ? 'Saving…' : 'Saved';
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

function setLangSegmentUI(hindi) {
    document.querySelectorAll('#langSegment .segment-btn').forEach((btn) => {
        const active = hindi ? btn.dataset.lang === 'hindi' : btn.dataset.lang === 'hinglish';
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const placeholder = hindi
        ? 'यहाँ हिंदी में टाइप करें...'
        : 'यहाँ Hinglish में टाइप करें...';
    document.querySelectorAll('.letter-page-input').forEach((ta, i) => {
        if (i === 0) ta.placeholder = placeholder;
        else ta.placeholder = '';
    });
}

function updateDocumentTitle() {
    const name = (filenameInput?.value || '').trim() || formatDocFilename(new Date(currentDoc.createdAt));
    const kind = currentDoc.type === 'diary' ? 'Diary' : 'Letter';
    document.title = `${name} · ${kind} — Bihar Police`;
}

function getActiveContent() {
    if (getActiveTemplate() === 'letter') return letterSheet?.getText() ?? '';
    return getDiaryContent();
}

function hasMeaningfulContent() {
    const type = getActiveTemplate();
    if (type === 'letter') return Boolean((letterSheet?.getText() ?? '').trim());
    return diaryHasMeaningfulContent(diarySheet?.getModel() ?? emptyModel());
}

function updatePageIndicator(current, total) {
    if (!pageIndicator) return;
    pageIndicator.hidden = false;
    pageIndicator.textContent = `Page ${current} of ${total}`;
}

async function flushSave() {
    saveTimer = null;
    if (!hasMeaningfulContent() && currentDoc.id == null) {
        setSaveStatus('saved');
        return;
    }
    const type = getActiveTemplate();
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

function startNewDocument(type = getActiveTemplate()) {
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const createdAt = new Date().toISOString();
    currentDoc = { id: null, type, createdAt };
    if (filenameInput) filenameInput.value = formatDocFilename(new Date(createdAt));

    if (type === 'letter') {
        document.querySelector('.editor-letter').style.display = '';
        document.querySelector('.editor-diary').style.display = 'none';
        setTemplateSegmentUI('letter');
        letterSheet?.clear();
        updatePageIndicator(1, letterSheet?.pageCount || 1);
        letterSheet?.focus();
    } else {
        document.querySelector('.editor-letter').style.display = 'none';
        document.querySelector('.editor-diary').style.display = '';
        setTemplateSegmentUI('diary');
        diarySheet?.clear();
        updatePageIndicator(1, diarySheet?.pageCount || 1);
    }
    setSaveStatus('saved');
    updateDocumentTitle();
}

function requestNewDocument(type = getActiveTemplate()) {
    if (hasMeaningfulContent()) {
        const ok = confirm('Start a new document? Current work is already saved in History.');
        if (!ok) return;
    }
    startNewDocument(type);
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
        startNewDocument(template);
        void loadHistoryFn?.();
    })();
}

function getCaretPosition(input) {
    // Get the bounding rectangle of the textarea
    const rect = input.getBoundingClientRect();

    // Create a temporary div to measure text
    const div = document.createElement('div');
    div.style.cssText = window.getComputedStyle(input, null).cssText;
    div.style.height = 'auto';
    div.style.position = 'absolute';
    div.style.whiteSpace = 'pre-wrap';
    div.style.top = '-9999px';
    div.style.opacity = '0';

    // Get the text before the cursor
    const textBeforeCursor = input.value.substring(0, input.selectionStart);
    div.textContent = textBeforeCursor;

    // Add a span at the end to measure cursor position
    const span = document.createElement('span');
    span.textContent = '.';
    div.appendChild(span);
    document.body.appendChild(div);

    // Calculate position
    const spanRect = span.getBoundingClientRect();
    const position = {
        top: spanRect.top - rect.top + input.scrollTop,
        left: spanRect.left - rect.left + input.scrollLeft
    };

    // Clean up
    document.body.removeChild(div);

    return position;
}

let typingTimer;
const doneTypingInterval = 50; // Reduced delay to 50ms for faster response

function notifyLetterChanged(el) {
    if (!el?.closest?.('.letter-page')) return;
    // Fires autosave + spill via existing input listeners.
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function attachTransliteration(el) {
    el.addEventListener('input', function () {
        if (el.closest('.letter-page') || el.closest('.editor-diary')) {
            scheduleSave();
        }
        if (isDictatedInput) {
            suggestionsBox.style.display = 'none';
            return;
        }
        if (isHindiMode) {
            suggestionsBox.style.display = 'none';
            return;
        }
        clearTimeout(typingTimer);
        const value = el.value;
        const cursor = el.selectionStart;
        const [start, end] = getWordBoundaries(value, Math.max(0, cursor - 1));
        const currentWord = value.slice(start, end);

        if (currentWord.trim()) {
            typingTimer = setTimeout(async () => {
                if (isHindiMode) return;
                const suggestions = await fetchSuggestions(currentWord);
                if (suggestions && suggestions.length > 0) {
                    showSuggestions(suggestions, start, end, el);
                }
            }, doneTypingInterval);
        } else {
            suggestionsBox.style.display = 'none';
        }
    });

    el.addEventListener('keydown', async function (e) {
        if (e.key !== ' ') return;
        if (isHindiMode) return;
        e.preventDefault();
        const value = el.value;
        const cursor = el.selectionStart;
        const [start, end] = getWordBoundaries(value, cursor - 1);
        const word = value.slice(start, end);

        if (!word.trim()) {
            el.value = value.slice(0, cursor) + ' ' + value.slice(cursor);
            el.selectionStart = el.selectionEnd = cursor + 1;
            notifyLetterChanged(el);
            return;
        }

        let suggestions = await fetchSuggestions(word);
        if (suggestions && suggestions.length > 0) {
            const suggestion = suggestions[0];
            const newValue = value.slice(0, start) + suggestion + ' ' + value.slice(end);
            el.value = newValue;
            el.selectionStart = el.selectionEnd = start + suggestion.length + 1;
        } else {
            el.value = value.slice(0, cursor) + ' ' + value.slice(cursor);
            el.selectionStart = el.selectionEnd = cursor + 1;
        }
        suggestionsBox.style.display = 'none';
        notifyLetterChanged(el);
    });

    el.addEventListener('click', async function () {
        if (isHindiMode) return;
        const value = el.value;
        const cursor = el.selectionStart;
        const [start, end] = getWordBoundaries(value, cursor);
        const word = value.slice(start, end);

        if (word.trim()) {
            const suggestions = await fetchSuggestions(word);
            if (suggestions && suggestions.length > 0) {
                showSuggestions(suggestions, start, end, el);
            }
        }
    });
}

document.addEventListener('click', function (e) {
    const tag = e.target.tagName;
    if (!suggestionsBox.contains(e.target) && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        suggestionsBox.style.display = 'none';
    }
});

function showSuggestions(suggestions, wordStart, wordEnd, targetEl) {
    suggestionsBox.innerHTML = '';
    if (!suggestions || suggestions.length === 0 || !targetEl) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const inputRect = targetEl.getBoundingClientRect();
    const style = window.getComputedStyle(targetEl);
    const lineHeight = parseInt(style.lineHeight) || 24;
    const paddingTop = parseInt(style.paddingTop) || 0;
    const paddingLeft = parseInt(style.paddingLeft) || 0;
    const textBeforeWord = targetEl.value.substring(0, wordStart);
    const lines = textBeforeWord.split('\n').length - 1;
    const currentLineText = textBeforeWord.split('\n').pop();
    const textWidth = getTextWidth(currentLineText, targetEl);

    suggestionsBox.style.position = 'fixed';
    suggestionsBox.style.left = (inputRect.left + paddingLeft + Math.min(textWidth, targetEl.offsetWidth - paddingLeft - 200)) + 'px';
    suggestionsBox.style.top = (inputRect.top + paddingTop + (lines + 1) * lineHeight + 5 - targetEl.scrollTop) + 'px';

    suggestions.forEach((suggestion) => {
        const div = document.createElement('div');
        div.className = 'suggestion';
        div.textContent = suggestion;
        div.onclick = () => {
            const value = targetEl.value;
            targetEl.value = value.slice(0, wordStart) + suggestion + value.slice(wordEnd);
            targetEl.selectionStart = targetEl.selectionEnd = wordStart + suggestion.length;
            suggestionsBox.style.display = 'none';
            notifyLetterChanged(targetEl);
        };
        div.title = `Insert “${suggestion}”`;
        suggestionsBox.appendChild(div);
    });

    suggestionsBox.style.display = 'block';

    const boxRect = suggestionsBox.getBoundingClientRect();
    const HEADER_HEIGHT = 65;
    if (boxRect.right > window.innerWidth) {
        suggestionsBox.style.left = (window.innerWidth - boxRect.width - 10) + 'px';
    }
    if (boxRect.bottom > window.innerHeight) {
        suggestionsBox.style.top = (inputRect.top + paddingTop + lines * lineHeight - boxRect.height - 5 - targetEl.scrollTop) + 'px';
    }
    if (parseInt(suggestionsBox.style.top) < HEADER_HEIGHT) {
        suggestionsBox.style.top = HEADER_HEIGHT + 'px';
    }
}

// Helper function to calculate text width
function getTextWidth(text, element) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    const font = window.getComputedStyle(element, null).getPropertyValue('font');
    context.font = font;
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

    // Adjust horizontal position if off-screen
    if (boxRect.right > viewportWidth) {
        suggestionsBox.style.left = (viewportWidth - boxRect.width - 10) + 'px';
    }

    // Adjust vertical position if off-screen
    if (boxRect.bottom > viewportHeight) {
        suggestionsBox.style.top = (parseInt(suggestionsBox.style.top) - boxRect.height - 40) + 'px';
    }
}

// Call adjustSuggestionsPosition after showing suggestions
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.target === suggestionsBox &&
            mutation.type === 'attributes' &&
            mutation.attributeName === 'style') {
            adjustSuggestionsPosition();
        }
    });
});

if (suggestionsBox) {
    observer.observe(suggestionsBox, { attributes: true });
}

function initApp() {
    const addTemplateBtn = document.querySelector('.add-template-btn');
    const exportBtn = document.getElementById('exportBtn');
    const historyList = document.querySelector('.history-list');

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

    // Render history in sidebar
    function renderHistory(docs = []) {
        historyList.innerHTML = '';

        if (!docs.length) {
            const empty = document.createElement('div');
            empty.className = 'history-empty';
            const kind = getActiveTemplate() === 'diary' ? 'diaries' : 'letters';
            empty.innerHTML = `<strong>No ${kind} yet</strong><span>Create one with the + button in the header.</span>`;
            historyList.appendChild(empty);
            return;
        }

        const groups = {};
        docs.forEach(doc => {
            const dateObj = new Date(doc.created_at || doc.timestamp || doc.date || Date.now());
            const dateKey = getDateString(dateObj);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push({ ...doc, date: dateObj });
        });

        const sortedDateKeys = Object.keys(groups).sort((a, b) => {
            return groups[b][0].date - groups[a][0].date;
        });

        sortedDateKeys.forEach(dateKey => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'history-date-group';

            const header = document.createElement('div');
            header.className = 'date-header collapsible-header';
            header.title = 'Expand or collapse this day';
            header.innerHTML = `<span class="collapse-arrow">&#9660;</span> ${dateKey}`;
            groupDiv.appendChild(header);

            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'history-items-container';

            groups[dateKey].sort((a, b) => b.date - a.date).forEach(doc => {
                const firstLine = previewText(doc);
                const created = new Date(doc.created_at || doc.date || Date.now());
                const updated = doc.updated_at ? new Date(doc.updated_at) : created;
                const createdStr = created.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const updatedStr = updated.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                const item = document.createElement('div');
                item.className = 'history-item';
                item.title = 'Open this document';
                if (currentDoc.id != null && doc.id === currentDoc.id) {
                    item.classList.add('is-active');
                }
                item.innerHTML = `
                    <i class="fas fa-file-alt"></i>
                    <div class="history-item-details">
                        <span class="history-item-name">${escapeHtml(doc.filename)}</span>
                        <span class="history-item-time">Created: ${createdStr}</span>
                        <span class="history-item-time">Last update: ${updatedStr}</span>
                        <span class="history-item-preview">${escapeHtml(firstLine)}</span>
                    </div>
                    <div class="history-item-actions">
                        <button class="delete-btn" type="button" title="Delete this document" aria-label="Delete this document"><i class="fas fa-trash"></i></button>
                    </div>
                `;

                function loadDoc() {
                    if (saveTimer !== null) {
                        clearTimeout(saveTimer);
                        saveTimer = null;
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
                        setDiaryContent(doc.content);
                        updatePageIndicator(1, diarySheet?.pageCount || 1);
                    } else {
                        document.querySelector('.editor-letter').style.display = '';
                        document.querySelector('.editor-diary').style.display = 'none';
                        setTemplateSegmentUI('letter');
                        letterSheet?.setText(doc.content || '');
                        letterSheet?.focus();
                        updatePageIndicator(1, letterSheet?.pageCount || 1);
                    }
                    setSaveStatus('saved');
                    updateDocumentTitle();
                    void loadHistory();
                }

                item.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-btn')) return;
                    loadDoc();
                });

                item.querySelector('.delete-btn').onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete "${doc.filename}" permanently? This cannot be undone.`)) return;
                    const ok = await deleteDocument(doc.type, doc.filename);
                    if (!ok) { alert('Failed to delete document.'); return; }
                    if (currentDoc.id != null && currentDoc.id === doc.id) {
                        startNewDocument(doc.type);
                    }
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

    if (letterPagesEl) {
        letterSheet = initPagedSheet(letterPagesEl, pageIndicator, {
            onChange: scheduleSave,
            onAttachField: (el) => {
                attachTransliteration(el);
            },
            onPageFocus: (current, total) => {
                if (getActiveTemplate() === 'letter') {
                    updatePageIndicator(current, total);
                }
            },
            onSpill: ({ toPage }) => {
                showNotification(`Continued on page ${toPage}`);
            },
        });
    }

    const diaryPagesEl = document.getElementById('diaryPages');
    const diaryTemplate = document.getElementById('diaryPageTemplate');
    if (diaryPagesEl && diaryTemplate) {
        diarySheet = initDiarySheet(diaryPagesEl, diaryTemplate, {
            onChange: scheduleSave,
            onAttachField: (el) => {
                if (el.matches('input:not([type="date"]), textarea')) {
                    attachTransliteration(el);
                }
                if (el.type === 'date') {
                    el.addEventListener('change', scheduleSave);
                }
            },
            onPageFocus: (current, total) => {
                if (getActiveTemplate() === 'diary') {
                    updatePageIndicator(current, total);
                }
            },
            onSpill: ({ toPage }) => {
                showNotification(`Continued on page ${toPage}`);
            },
        });
    }

    startNewDocument('diary');
    void loadHistory();
    try {
        letterSheet?.update();
    } catch (err) {
        console.error('letterSheet.update failed:', err);
    }

    filenameInput?.addEventListener('change', () => {
        scheduleSave();
        updateDocumentTitle();
    });
    filenameInput?.addEventListener('blur', () => {
        if (!(filenameInput.value || '').trim()) {
            filenameInput.value = formatDocFilename(new Date(currentDoc.createdAt));
        }
        scheduleSave();
        updateDocumentTitle();
    });
    filenameInput?.addEventListener('input', () => {
        updateDocumentTitle();
    });

    async function runPdfExport() {
        const activeTemplate = getActiveTemplate();
        let content = '';
        if (activeTemplate === 'letter') {
            content = letterPagesHtml(letterSheet?.getPages() ?? ['']);
        } else {
            const model = diarySheet?.getModel() ?? emptyModel();
            content = diaryPagesHtml(model);
        }
        if (!content) return alert('Cannot export empty document!');

        const printStyles = activeTemplate === 'letter' ? letterPrintCss() : diaryPrintCss();
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Print Document</title>
                <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;700&display=swap" rel="stylesheet">
                <style>
                    ${printStyles}
                </style>
            </head>
            <body>
                ${content}
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.onload = function () {
            printWindow.print();
            printWindow.onafterprint = function () {
                printWindow.close();
            };
        };
    }

    exportBtn?.addEventListener('click', () => { void runPdfExport(); });

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
        mainContent?.classList.toggle('shifted', open);
        const switchIcon = switchBtn?.querySelector('.switch-icon');
        if (switchIcon) switchIcon.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
    }

    switchBtn?.addEventListener('click', function (e) {
        e.stopPropagation();
        setSidebarOpen(!isToggled);
    });

    document.addEventListener('click', function (e) {
        if (isToggled &&
            sidebar && switchBtn &&
            !sidebar.contains(e.target) &&
            !switchBtn.contains(e.target)) {
            setSidebarOpen(false);
        }
    });

    document.querySelectorAll('#templateSegment .segment-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            switchTemplate(btn.dataset.template);
        });
    });

    document.querySelectorAll('#langSegment .segment-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            isHindiMode = btn.dataset.lang === 'hindi';
            setLangSegmentUI(isHindiMode);
            suggestionsBox.style.display = 'none';
        });
    });
    setLangSegmentUI(false);

    addTemplateBtn?.addEventListener('click', function () {
        requestNewDocument(getActiveTemplate());
    });

    document.addEventListener('keydown', (e) => {
        const meta = e.metaKey || e.ctrlKey;
        const tag = (e.target && e.target.tagName) || '';
        const typing = tag === 'INPUT' || tag === 'TEXTAREA';

        if (e.key === 'Escape') {
            // Dictation Esc is handled in capture phase by dictation-ui.
            if (isToggled) setSidebarOpen(false);
            return;
        }

        if (!meta) return;

        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            void runPdfExport();
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
    });

    // Track focus/selection for voice dictation insertion target
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        if (el === filenameInput) return;
        if (!el.closest('.editor-letter') && !el.closest('.editor-diary')) return;
        if (el.type === 'date') return;
        dictationTarget = {
            el,
            start: el.selectionStart ?? el.value.length,
            end: el.selectionEnd ?? el.value.length,
        };
    });
    document.addEventListener('selectionchange', () => {
        const el = document.activeElement;
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
 * Resolve the current dictation insertion target (caret + element).
 * Falls back to the letter textarea when nothing is tracked.
 * @returns {{ el: HTMLInputElement|HTMLTextAreaElement, start: number, end: number } | null}
 */
function getDictationTarget() {
    const active = document.activeElement;
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

    if (dictationTarget?.el?.isConnected) {
        return dictationTarget;
    }

    if (getActiveTemplate() === 'letter') {
        const field = letterSheet?.getActiveField();
        if (field?.el) {
            field.el.focus();
            dictationTarget = field;
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
    const start = target.start ?? el.selectionStart ?? el.value.length;
    const end = target.end ?? el.selectionEnd ?? el.value.length;
    const value = el.value;
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;

    isDictatedInput = true;
    try {
        el.value = next;
        el.focus();
        el.selectionStart = el.selectionEnd = caret;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
        isDictatedInput = false;
    }

    // Diary spill may move focus to another textarea — adopt it
    const active = document.activeElement;
    if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        (active.closest('.editor-letter') || active.closest('.editor-diary'))
    ) {
        dictationTarget = {
            el: active,
            start: active.selectionStart ?? active.value.length,
            end: active.selectionEnd ?? active.value.length,
        };
    } else {
        dictationTarget = { el, start: caret, end: caret };
    }
}

// Serialize diary model as JSON
function getDiaryContent() {
    return JSON.stringify(diarySheet?.getModel() ?? emptyModel());
}

// Restore diary model from JSON (legacy flat format handled in normalizeDiaryModel)
function setDiaryContent(content) {
    diarySheet?.setModel(content);
}
