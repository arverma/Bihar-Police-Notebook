// Data Manager - Handles form data operations
export class DataManager {
    constructor() {
        // No longer need the old input reference since we use Quill for letters
    }

    // Get diary content for saving
    getDiaryContent() {
        const container = document.getElementById('diaryExportLayout');
        const inputs = container.querySelectorAll('input[data-field], textarea[data-field]');
        const data = {};
        inputs.forEach(input => {
            data[input.getAttribute('data-field')] = input.value || '';
        });
        // Include Quill editor contents (HTML) for diary left/right boxes
        const { left, right } = this.getDiaryQuillContent();
        if (typeof left === 'string') data.left_box = left;
        if (typeof right === 'string') data.right_box = right;
        return data;
    }

    // Set diary content for loading
    setDiaryContent(data) {
        const container = document.getElementById('diaryExportLayout');
        const inputs = container.querySelectorAll('input[data-field], textarea[data-field]');
        inputs.forEach(input => {
            const key = input.getAttribute('data-field');
            if (data && data.hasOwnProperty(key)) {
                input.value = data[key];
            } else {
                input.value = '';
            }
        });

        // Populate Quill editors for diary boxes if present
        this.setDiaryQuillContent({
            left: (data && typeof data.left_box === 'string') ? data.left_box : '',
            right: (data && typeof data.right_box === 'string') ? data.right_box : ''
        });
    }

    // Get letter content
    getLetterContent() {
        // Get the global quillEditor instance
        const quillEditor = window.quillEditor;
        if (quillEditor) {
            // Return HTML content for rich text
            return quillEditor.root.innerHTML.trim();
        }
        return '';
    }

    // Set letter content
    setLetterContent(content) {
        // Get the global quillEditor instance
        const quillEditor = window.quillEditor;
        if (quillEditor) {
            // Check if content is HTML or plain text
            if (content.includes('<') && content.includes('>')) {
                quillEditor.root.innerHTML = content;
            } else {
                quillEditor.setText(content);
            }
        }
    }

    // Clear all form data
    clearFormData(template) {
        if (template === 'letter') {
            const quillEditor = window.quillEditor;
            if (quillEditor) {
                quillEditor.setText('');
            }
        } else {
            const container = document.getElementById('diaryExportLayout');
            container.querySelectorAll('input, textarea').forEach(el => el.value = '');

            // Also clear diary Quill editors if available
            this.clearDiaryQuillEditors();
        }
    }

    // Get form data for a specific template
    getFormData(template) {
        if (template === 'letter') {
            return this.getLetterContent();
        } else {
            return this.getDiaryContent();
        }
    }

    // Set form data for a specific template
    setFormData(template, content) {
        if (template === 'letter') {
            this.setLetterContent(content);
        } else {
            this.setDiaryContent(content);
        }
    }

    // --- Quill helpers (centralized) ---
    getDiaryQuillContent() {
        try {
            const leftQuill = window.diaryQuillEditors?.leftBox;
            const rightQuill = window.diaryQuillEditors?.rightBox;

            const getHtml = (q) => (q?.root?.innerHTML || '').trim();

            return {
                left: leftQuill ? getHtml(leftQuill) : this._readDiaryEditorFallback('left'),
                right: rightQuill ? getHtml(rightQuill) : this._readDiaryEditorFallback('right')
            };
        } catch (_) {
            return {
                left: this._readDiaryEditorFallback('left'),
                right: this._readDiaryEditorFallback('right')
            };
        }
    }

    setDiaryQuillContent({ left = '', right = '' } = {}) {
        try {
            const leftQuill = window.diaryQuillEditors?.leftBox;
            const rightQuill = window.diaryQuillEditors?.rightBox;

            if (leftQuill) {
                if (left.includes('<') && left.includes('>')) leftQuill.root.innerHTML = left; else leftQuill.setText(left);
            }
            if (rightQuill) {
                if (right.includes('<') && right.includes('>')) rightQuill.root.innerHTML = right; else rightQuill.setText(right);
            }
        } catch (_) {}
    }

    clearDiaryQuillEditors() {
        try {
            if (window.diaryQuillEditors?.leftBox) window.diaryQuillEditors.leftBox.setText('');
            if (window.diaryQuillEditors?.rightBox) window.diaryQuillEditors.rightBox.setText('');
        } catch (_) {}
    }

    _readDiaryEditorFallback(which) {
        const id = which === 'right' ? 'quill-right-box' : 'quill-left-box';
        const el = document.getElementById(id)?.querySelector('.ql-editor');
        return el ? el.innerHTML.trim() : '';
    }
} 