import { pagedExportTemplates } from './export_templates.js';
import { DataManager } from './data_manager.js';

// Export Manager - Handles all export functionality
export class ExportManager {
    constructor() {
        this.dataManager = new DataManager();
    }

    // Main export handler
    async handleExport(template) {
        try {
            if (template === 'letter') {
                await this.exportLetter();
            } else {
                await this.exportDiary();
            }
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed: ' + error.message);
        }
    }

    // Export letter with proper Quill content handling
    async exportLetter() {
        const content = this.dataManager.getLetterContent();
        if (!content) {
            throw new Error('Cannot export empty document!');
        }

        // Get formatted content from centralized helper
        const formattedContent = this.getQuillContent();
        
        // Create letter content with proper HTML handling
        const letterContent = pagedExportTemplates.letterContent({ 
            letter_content: formattedContent 
        });
        
        const documentHtml = pagedExportTemplates.createDocument(letterContent, 'Letter Export');
        this.openPrintWindow(documentHtml);
    }

    // Export diary with CSS Paged Media (unchanged)
    exportDiary() {
        const container = document.getElementById('diaryExportLayout');

        // Log all data-field attributes in the container
        const dataFields = Array.from(container.querySelectorAll('[data-field]')).map(el => el.getAttribute('data-field'));
        console.log('data-fields in container:', dataFields);
        
        const get = field => container.querySelector(`[data-field="${field}"]`)?.value || '';
        
        // Get content from Quill editors if available, otherwise fallback to textareas
        let leftContent = '';
        let rightContent = '';
        
        if (window.diaryQuillEditors?.leftBox) {
            leftContent = window.diaryQuillEditors.leftBox.root.innerHTML;
        } else {
            leftContent = get('left_box');
        }
        
        if (window.diaryQuillEditors?.rightBox) {
            rightContent = window.diaryQuillEditors.rightBox.root.innerHTML;
        } else {
            rightContent = get('right_box');
        }
        
        if (!leftContent && !rightContent) {
            alert('Cannot export empty document!');
            return;
        }

        // Create diary content with proper structure
        const diaryData = {
            case_diary_no: get('case_diary_no'),
            rule_no: get('rule_no'),
            special_report_no: get('special_report_no'),
            thana: get('thana'),
            district: get('district'),
            against_1: get('against_1'),
            against_2: get('against_2'),
            fir_number: get('fir_number'),
            fir_date: get('fir_date'),
            event_date_place: get('event_date_place'),
            sections: get('sections'),
            left_box: leftContent,
            right_box: rightContent
        };
        console.log("diaryData", diaryData);

        // Build content with header and table - let CSS handle pagination
        const diaryContent = pagedExportTemplates.diaryHeader(diaryData) + 
                           pagedExportTemplates.diaryTable({
                               showHeader: true,
                               left_box: leftContent,
                               right_box: rightContent,
                               investigation_record: get('investigation_record')
                           });

        const documentHtml = pagedExportTemplates.createDocument(diaryContent, 'Diary Export');
        
        this.openPrintWindow(documentHtml);
    }

    // Export as HTML file (for sharing)
    async exportLetterHTML() {
        const formattedContent = this.getQuillContent();
        if (!formattedContent || formattedContent === '<p><br></p>') {
            throw new Error('Cannot export empty document!');
        }

        const letterContent = pagedExportTemplates.letterContent({ 
            letter_content: formattedContent 
        });
        
        const documentHtml = pagedExportTemplates.createDocument(letterContent, 'Letter Export');
        this.downloadHTML(documentHtml, 'letter.html');
    }

    // Export Utilities
    openPrintWindow(htmlContent) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        printWindow.onload = function () {
            printWindow.print();
            printWindow.onafterprint = function () {
                printWindow.close();
            };
        };
    }

    downloadHTML(htmlContent, filename) {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Get Quill content in different formats
    getQuillContent() {
        const quillEditor = window.quillEditor;
        if (!quillEditor) return '';
        return quillEditor.root.innerHTML;
    }
} 