import { getWordBoundaries } from './utils.js';
import { fetchSuggestions } from './translit.js';
import { getDocuments, saveDocument, deleteDocument, previewText } from './store.js';

const input = document.getElementById('hinglish-input');
const suggestionsBox = document.getElementById('suggestions');

const STORAGE_KEY = 'biharPolice_autosave';

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

function attachTransliteration(el) {
    el.addEventListener('input', function () {
        clearTimeout(typingTimer);
        const value = el.value;
        const cursor = el.selectionStart;
        const [start, end] = getWordBoundaries(value, Math.max(0, cursor - 1));
        const currentWord = value.slice(start, end);

        if (currentWord.trim()) {
            typingTimer = setTimeout(async () => {
                const suggestions = await fetchSuggestions(currentWord);
                if (suggestions && suggestions.length > 0) {
                    showSuggestions(suggestions, start, end, el);
                }
            }, doneTypingInterval);
        } else {
            suggestionsBox.style.display = 'none';
        }

        if (el === input) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(saveToLocalStorage, AUTOSAVE_DELAY);
        }
    });

    el.addEventListener('keydown', async function (e) {
        if (e.key === ' ') {
            e.preventDefault();
            const value = el.value;
            const cursor = el.selectionStart;
            const [start, end] = getWordBoundaries(value, cursor - 1);
            const word = value.slice(start, end);

            if (!word.trim()) {
                el.value = value.slice(0, cursor) + ' ' + value.slice(cursor);
                el.selectionStart = el.selectionEnd = cursor + 1;
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
        }
    });

    el.addEventListener('click', async function () {
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

attachTransliteration(input);

document.addEventListener('click', function (e) {
    const tag = e.target.tagName;
    if (!suggestionsBox.contains(e.target) && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        suggestionsBox.style.display = 'none';
    }
});

function showSuggestions(suggestions, wordStart, wordEnd, targetEl = input) {
    suggestionsBox.innerHTML = '';
    if (!suggestions || suggestions.length === 0) {
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
        };
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

observer.observe(suggestionsBox, { attributes: true });

// Wait for DOM to load before adding event listeners
document.addEventListener('DOMContentLoaded', function () {
    const addTemplateBtn = document.querySelector('.add-template-btn');
    const newFileModal = document.getElementById('newFileModal');
    const closeNewFile = document.getElementById('closeNewFile');
    const cancelNewFile = document.getElementById('cancelNewFile');
    const createNewFile = document.getElementById('createNewFile');
    const newFileName = document.getElementById('newFileName');
    const exportBtn = document.getElementById('exportBtn');
    const saveBtn = document.getElementById('saveBtn');
    const filenameInput = document.querySelector('.filename-input');
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

    function getActiveTemplate() {
        return document.querySelector('.editor-letter').style.display !== 'none' ? 'letter' : 'diary';
    }

    // Save document to server
    saveBtn.addEventListener('click', async function () {
        const filename = filenameInput.value.trim() || 'Untitled';
        const type = getActiveTemplate();
        let content = '';
        if (type === 'letter') {
            content = input.value;
            if (!content.trim()) return alert('Cannot save empty document!');
        } else {
            content = getDiaryContent();
            let parsed = {};
            try { parsed = JSON.parse(content); } catch (e) { parsed = {}; }
            if (!Object.values(parsed).some(v => String(v).trim())) return alert('Cannot save empty document!');
        }

        try {
            await saveDocument(type, filename, content);
            showNotification('Document saved!');
            await loadHistory();
        } catch (err) {
            alert('Failed to save document: ' + err);
        }
    });

    // Render history in sidebar
    function renderHistory(docs = []) {
        // Group by date
        const groups = {};
        docs.forEach(doc => {
            const dateObj = new Date(doc.created_at || doc.timestamp || doc.date || Date.now());
            const dateKey = getDateString(dateObj);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push({ ...doc, date: dateObj });
        });

        historyList.innerHTML = '';

        // Sort date keys by latest date first
        const sortedDateKeys = Object.keys(groups).sort((a, b) => {
            // Parse the first doc's date in each group for sorting
            const aDate = groups[a][0].date;
            const bDate = groups[b][0].date;
            return bDate - aDate; // Descending order
        });

        sortedDateKeys.forEach(dateKey => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'history-date-group';

            const header = document.createElement('div');
            header.className = 'date-header collapsible-header';
            header.innerHTML = `<span class="collapse-arrow">&#9660;</span> ${dateKey}`;
            groupDiv.appendChild(header);

            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'history-items-container';

            // Sort docs in group by created_at descending (latest first)
            groups[dateKey].sort((a, b) => b.date - a.date).forEach(doc => {
                const firstLine = previewText(doc);
                const created = new Date(doc.created_at || doc.date || Date.now());
                const updated = doc.updated_at ? new Date(doc.updated_at) : created;
                const createdStr = created.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const updatedStr = updated.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                const item = document.createElement('div');
                item.className = 'history-item';
                item.innerHTML = `
                    <i class="fas fa-file-alt"></i>
                    <div class="history-item-details">
                        <span class="history-item-name">${escapeHtml(doc.filename)}</span>
                        <span class="history-item-time">Created: ${createdStr}</span>
                        <span class="history-item-time">Last update: ${updatedStr}</span>
                        <span class="history-item-preview">${escapeHtml(firstLine)}</span>
                    </div>
                    <div class="history-item-actions">
                        <button class="edit-btn" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="delete-btn" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                `;

                function loadDoc() {
                    filenameInput.value = doc.filename;
                    if (doc.type === 'diary') {
                        document.querySelector('.editor-letter').style.display = 'none';
                        document.querySelector('.editor-diary').style.display = '';
                        document.querySelector('.template-filter .filter-text').textContent = 'Diary';
                        setDiaryContent(doc.content);
                    } else {
                        document.querySelector('.editor-letter').style.display = '';
                        document.querySelector('.editor-diary').style.display = 'none';
                        document.querySelector('.template-filter .filter-text').textContent = 'Letter';
                        input.value = doc.content;
                        input.focus();
                    }
                }

                item.querySelector('.history-item-details').onclick = loadDoc;
                item.querySelector('.edit-btn').onclick = (e) => {
                    e.stopPropagation();
                    loadDoc();
                };

                item.querySelector('.delete-btn').onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${doc.filename}"?`)) {
                        const ok = await deleteDocument(doc.type, doc.filename);
                        if (!ok) { alert('Failed to delete document.'); return; }
                        showNotification('Document deleted.');
                        await loadHistory();
                    }
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
            const [letters, diaries] = await Promise.all([
                getDocuments('letter'),
                getDocuments('diary'),
            ]);
            renderHistory([...letters, ...diaries]);
        } catch (err) {
            console.error('Failed to load history:', err);
        }
    }

    // Initial render
    loadHistory();
    restoreSavedContent();

    // Close modal handlers
    [closeNewFile, cancelNewFile].forEach(btn => {
        btn.addEventListener('click', function () {
            newFileModal.style.display = 'none';
            newFileName.value = '';
        });
    });

    // Update the export button handler
    exportBtn.addEventListener('click', async function () {
        let content = '';
        if (getActiveTemplate() === 'letter') {
            content = `<pre style="font-family: 'Noto Sans Devanagari', Arial, sans-serif; font-size: 18px; margin: 0; padding: 0; background: #fff; border: none; white-space: pre-wrap; word-break: break-word;">${escapeHtml(input.value)}</pre>`;
        } else {
            const container = document.getElementById('diaryExportLayout');
            const get = field => container.querySelector(`[data-field="${field}"]`)?.value || '';

            // --- PAGINATION LOGIC ---
            // Adjust this limit for your print size/font
            const CHARS_PER_PAGE = 500; // First page
            const CHARS_PER_PAGE_SECONDARY = 900; // Subsequent pages

            function paginateColumns(left, right, limitFirst, limitRest) {
                const leftPages = [];
                const rightPages = [];
                let i = 0, j = 0;
                let first = true;
                while (i < left.length || j < right.length) {
                    const limit = first ? limitFirst : limitRest;
                    leftPages.push(left.slice(i, i + limit));
                    rightPages.push(right.slice(j, j + limit));
                    i += limit;
                    j += limit;
                    first = false;
                }
                return [leftPages, rightPages];
            }

            const [leftPages, rightPages] = paginateColumns(
                get('left_box'),
                get('right_box'),
                CHARS_PER_PAGE,
                CHARS_PER_PAGE_SECONDARY
            );
            const maxPages = leftPages.length;

            // Header HTML (repeat on every page)
            function getHeader(get) {
                return `
                <div style="font-family: 'Noto Sans Devanagari', Arial, sans-serif; font-size: 15px; max-width: 900px; margin:auto; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="font-size:13px; line-height:1.4;">
                            अनुसूची 47, प सं0 120 अ<br>
                            आ0 ह0 प सं0 30 अ
                        </div>
                        <div style="text-align:center; flex:1; margin-top:2px;">
                            <span style="font-size:17px;font-weight:bold;">
                                केस-दैनिकी सं0
                                <span style="display:inline-block; min-width:80px; border-bottom:1px dotted #333; text-align:center;">
                                    ${escapeHtml(get('case_diary_no'))}
                                </span>
                            </span>
                            <div style="font-size:14px; margin-top:2px;">
                                (नियम-${escapeHtml(get('rule_no'))})
                            </div>
                        </div>
                        <div style="font-size:13px; min-width:110px; text-align:right;">
                            &nbsp;
                        </div>
                    </div>
                    <div style="text-align:right; margin-top: 2px;">
                        <span style="display:inline-block; min-width:120px; border-bottom:1px dotted #333;">${escapeHtml(get('against_1'))}</span>
                        <span style="margin:0 10px;">बनाम</span>
                        <span style="display:inline-block; min-width:120px; border-bottom:1px dotted #333;">${escapeHtml(get('against_2'))}</span>
                    </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 2px;">
                        <div style="text-align:right;">
                            <span>विशेष रिपोर्ट केस सं.</span>
                            <span style="display:inline-block; min-width:100px; border-bottom:1px dotted #333;">${escapeHtml(get('special_report_no'))}</span>
                        </div>
                    </div>
                    <div style="margin-top: 12px; font-size:15px;">
                        थाना&nbsp;<b>${escapeHtml(get('thana')) || '....................'}</b>&nbsp;&nbsp;
                        जिला&nbsp;<b>${escapeHtml(get('district')) || '....................'}</b>&nbsp;&nbsp;
                        प्रथम इत्तिला रिपोर्ट सं.&nbsp;<b>${escapeHtml(get('fir_number')) || '....................'}</b>&nbsp;&nbsp;
                        तिथि&nbsp;<b>${escapeHtml(get('fir_date')) || '....................'}</b>&nbsp;&nbsp;
                        घटना की तिथि और स्थान&nbsp;<b>${escapeHtml(get('event_date_place')) || '....................................................'}</b>&nbsp;&nbsp;
                        धाराः&nbsp;<b>${escapeHtml(get('sections')) || '....................................................'}</b>
                    </div>
                    <div style="margin-top:12px; border-top:1px solid #333;"></div>
                </div>
                `;
            }

            // Table HTML for each page
            function getTable(left, right, showHeader = false) {
                return `
                    <table style="width:100%;margin-top:20px;border-collapse:collapse;table-layout:fixed;">
                        ${showHeader ? `
                        <tr>
                            <td style="width:32%;border-top:1px solid #000;border-bottom:1px solid #000;border-left:none;border-right:1px solid #000;vertical-align:top;padding:8px;">
                                <b>किन तिथि को (समय सहित )<br>कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया |</b>
                            </td>
                            <td style="width:68%;border-top:1px solid #000;border-bottom:1px solid #000;border-left:none;border-right:none;vertical-align:top;padding:8px;">
                                <b>अन्वेषण का अभिलेख</b><br>
                                <div>(01)</div>
                            </td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td style="width:32%;border-top:none;border-bottom:1px solid #000;border-left:none;border-right:1px solid #000;vertical-align:top;padding:8px;">
                                <div style="min-height:400px;margin-top:8px;white-space:pre-wrap;">${escapeHtml(left || '')}</div>
                            </td>
                            <td style="width:68%;border-top:none;border-bottom:1px solid #000;border-left:none;border-right:none;vertical-align:top;padding:8px;">
                                <div style="min-height:400px;margin-top:8px;white-space:pre-wrap;">${escapeHtml(right || '')}</div>
                            </td>
                        </tr>
                    </table>
                    </div>
                    <div style="page-break-after:always"></div>
                `;
            }

            // Build all pages
            let pagesHtml = '';
            for (let i = 0; i < maxPages; i++) {
                if (i === 0) {
                    pagesHtml += getHeader(get) + getTable(leftPages[i], rightPages[i], true);
                } else {
                    pagesHtml += getTable(leftPages[i], rightPages[i], false);
                }
            }
            content = pagesHtml;
        }
        if (!content) return alert('Cannot export empty document!');

        // Open print window with the formatted content
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Print Document</title>
                <style>
                    @media print {
                        body { margin: 20mm 15mm 20mm 15mm; }
                    }
                    body {
                        margin: 20mm 15mm 20mm 15mm;
                        background: #fff;
                    }
                    pre {
                        font-family: 'Noto Sans Devanagari', Arial, sans-serif;
                        font-size: 18px;
                        margin: 0;
                        padding: 0;
                        background: #fff;
                        border: none;
                        white-space: pre-wrap;
                        word-break: break-word;
                    }
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
    });

    // Add New Doc logic (clear the correct editor)
    createNewFile.addEventListener('click', function () {
        const fileName = newFileName.value.trim();
        if (fileName) {
            filenameInput.value = fileName;
            newFileModal.style.display = 'none';
            if (getActiveTemplate() === 'letter') {
                input.value = '';
                input.focus();
            } else {
                // Clear all FIR Diary fields
                const container = document.getElementById('diaryExportLayout');
                container.querySelectorAll('input, textarea').forEach(el => el.value = '');
            }
        }
    });

    const switchBtn = document.querySelector('.switch-btn');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    let isToggled = false;

    switchBtn.addEventListener('click', function () {
        isToggled = !isToggled;
        this.classList.toggle('active');
        sidebar.classList.toggle('open');
        mainContent.classList.toggle('shifted');

        // Rotate switch icon when sidebar is open
        const switchIcon = this.querySelector('.switch-icon');
        switchIcon.style.transform = isToggled ? 'rotate(180deg)' : 'rotate(0)';
    });

    // Close sidebar when clicking outside
    document.addEventListener('click', function (e) {
        if (isToggled &&
            !sidebar.contains(e.target) &&
            !switchBtn.contains(e.target)) {
            isToggled = false;
            switchBtn.classList.remove('active');
            sidebar.classList.remove('open');
            mainContent.classList.remove('shifted');
            switchBtn.querySelector('.switch-icon').style.transform = 'rotate(0)';
        }
    });

    // Language toggle functionality
    const langToggleBtn = document.querySelector('.lang-toggle-btn');
    let isHindi = false;

    langToggleBtn && langToggleBtn.addEventListener('click', function () {
        isHindi = !isHindi;
        this.classList.toggle('active');

        // Toggle the icon
        const icon = this.querySelector('i');
        icon.classList.toggle('fa-toggle-on');
        icon.classList.toggle('fa-toggle-off');

        // Update textarea placeholder based on language
        const textarea = document.getElementById('hinglish-input');
        textarea.placeholder = isHindi ?
            "यहाँ हिंदी में टाइप करें..." :
            "यहाँ Hinglish में टाइप करें...";

        // Enable/disable transliteration logic
        if (isHindi) {
            // Hindi mode: direct typing, no transliteration
            textarea.removeEventListener('input', transliterateOnInput);
            textarea.removeEventListener('keydown', transliterateOnSpace);
        } else {
            // Hinglish mode: enable transliteration
            textarea.addEventListener('input', transliterateOnInput);
            textarea.addEventListener('keydown', transliterateOnSpace);
        }
    });

    // --- Transliteration logic for Hinglish mode ---
    async function transliterateOnInput(e) {
        // Only transliterate if not in Hindi mode
        if (isHindi) return;
    }

    async function transliterateOnSpace(e) {
        if (isHindi) return;
        if (e.key === ' ') {
            e.preventDefault();
            const value = input.value;
            const cursor = input.selectionStart;
            const [start, end] = getWordBoundaries(value, cursor - 1);
            const word = value.slice(start, end);

            if (!word.trim()) {
                input.value = value.slice(0, cursor) + ' ' + value.slice(cursor);
                input.selectionStart = input.selectionEnd = cursor + 1;
                return;
            }

            let suggestions = await fetchSuggestions(word);
            if (suggestions && suggestions.length > 0) {
                // Auto-replace with first suggestion
                const suggestion = suggestions[0];
                const newValue = value.slice(0, start) + suggestion + ' ' + value.slice(end);
                input.value = newValue;
                input.selectionStart = input.selectionEnd = start + suggestion.length + 1;
            } else {
                input.value = value.slice(0, cursor) + ' ' + value.slice(cursor);
                input.selectionStart = input.selectionEnd = cursor + 1;
            }
            suggestionsBox.style.display = 'none';
        }
    }

    function updateLogoBg() {
        if (input.value.trim() === '') {
            input.classList.add('bg-logo');
        } else {
            input.classList.remove('bg-logo');
        }
    }
    updateLogoBg();
    input.addEventListener('input', updateLogoBg);

    document.querySelectorAll('.template-filter .dropdown-content a').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const template = this.getAttribute('data-template');
            // Toggle editor visibility
            document.querySelector('.editor-letter').style.display = (template === 'letter') ? '' : 'none';
            document.querySelector('.editor-diary').style.display = (template === 'diary') ? '' : 'none';
            
            // Optionally update dropdown label
            document.querySelector('.template-filter .filter-text').textContent = this.textContent;
        });
    });

    addTemplateBtn.addEventListener('click', function () {
        newFileModal.style.display = 'flex';
        document.getElementById('newFileName').focus();
    });

    // Attach transliteration to all diary inputs and textareas (skip date pickers)
    document.querySelectorAll('.editor-diary input:not([type="date"]), .editor-diary textarea').forEach(el => {
        attachTransliteration(el);
    });

    // Sync diary textarea heights
    const leftTextarea = document.querySelector('textarea[data-field="left_box"]');
    const rightTextarea = document.querySelector('textarea[data-field="right_box"]');
    if (leftTextarea && rightTextarea) {
        leftTextarea.addEventListener('input', syncDiaryTextareaHeights);
        rightTextarea.addEventListener('input', syncDiaryTextareaHeights);
        syncDiaryTextareaHeights();
    }
});

let autoSaveTimer;
const AUTOSAVE_DELAY = 1000; // Save after 1 second of inactivity

// Auto-save functionality
function saveToLocalStorage() {
    const contentToSave = {
        mainInput: input.value,
        timestamp: new Date().getTime()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contentToSave));
}

// Restore saved content
function restoreSavedContent() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const { mainInput, timestamp } = JSON.parse(saved);
            input.value = mainInput;

            // Show restoration message
            const timeDiff = Math.round((new Date().getTime() - timestamp) / 60000);
            const message = `पिछला कार्य पुनर्स्थापित किया गया (${timeDiff} मिनट पहले का)`;
            showNotification(message);
        }
    } catch (error) {
        console.error('Error restoring saved content:', error);
    }
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
// Serialize all FIR Diary fields as JSON keyed by data-field
function getDiaryContent() {
    const container = document.getElementById('diaryExportLayout');
    const data = {};
    container.querySelectorAll('[data-field]').forEach(el => {
        data[el.dataset.field] = el.value || '';
    });
    return JSON.stringify(data);
}

// Restore FIR Diary fields from JSON (with legacy line-format fallback)
function setDiaryContent(content) {
    const container = document.getElementById('diaryExportLayout');
    let data = {};
    try {
        data = typeof content === 'string' ? JSON.parse(content) : (content || {});
    } catch (e) {
        // Legacy line-by-line format fallback
        const inputs = [...container.querySelectorAll('[data-field]')];
        const lines = (content || '').split('\n');
        inputs.forEach((el, i) => { el.value = lines[i] ? lines[i].replace(/^.*?:\s*/, '') : ''; });
        return;
    }
    container.querySelectorAll('[data-field]').forEach(el => {
        if (el.dataset.field in data) el.value = data[el.dataset.field];
    });
}

// Sync heights of diary textareas
function syncDiaryTextareaHeights() {
    const left = document.querySelector('textarea[data-field="left_box"]');
    const right = document.querySelector('textarea[data-field="right_box"]');
    if (!left || !right) return;
    left.style.height = 'auto';
    right.style.height = 'auto';
    const maxHeight = Math.max(left.scrollHeight, right.scrollHeight);
    left.style.height = right.style.height = maxHeight + 'px';
}


