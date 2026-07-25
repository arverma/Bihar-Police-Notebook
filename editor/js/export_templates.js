// New CSS Paged Media Export Templates
export const pagedExportTemplates = {
    // Complete document with proper CSS Paged Media
    createDocument: (content, title = 'Document') => `
        <!DOCTYPE html>
        <html lang="hi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;700&display=swap" rel="stylesheet">
            <style>
                /* Reset and base styles */
                * { 
                    margin: 0; 
                    padding: 0; 
                    box-sizing: border-box; 
                }

                body {
                    font-size: 16px;
                }

                /* Page container - let content flow naturally */
                .page-container {
                    width: 100%;
                    max-width: none;
                }

                /* Letter styles */
                .letter-content {
                    font-size: inherit;
                    line-height: 1.8;
                    word-break: break-word;
                    font-family: 'Noto Sans Devanagari', Arial, sans-serif;
                }

                /* Rich text formatting styles */
                .letter-content strong,
                .letter-content b {
                    font-weight: bold;
                }

                .letter-content em,
                .letter-content i {
                    font-style: italic;
                }

                .letter-content u {
                    text-decoration: underline;
                }

                .letter-content s,
                .letter-content strike {
                    text-decoration: line-through;
                }

                .letter-content blockquote {
                    border-left: 4px solid #ccc;
                    margin: 0 0 1em 0;
                    padding-left: 1em;
                    font-style: italic;
                }

                .letter-content h1,
                .letter-content h2 {
                    font-weight: bold;
                    margin: 1em 0 0.5em 0;
                }

                .letter-content h1 {
                    font-size: 1.5em;
                }

                .letter-content h2 {
                    font-size: 1.3em;
                }

                /* Quill size classes */
                .letter-content .ql-size-small {
                    font-size: 0.75em;
                }

                .letter-content .ql-size-large {
                    font-size: 1.5em;
                }

                .letter-content .ql-size-huge {
                    font-size: 2.5em;
                }

                .letter-content ul,
                .letter-content ol {
                    margin: 0.5em 0;
                    padding-left: 2em;
                }

                .letter-content li {
                    margin: 0.2em 0;
                }

                .letter-content p {
                    margin: 0.5em 0;
                }

                /* Diary styles */
                .diary-header {
                    margin-bottom: 20px;
                    font-size: inherit;
                    page-break-after: avoid;
                }

                .header-top {
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    align-items: start;
                    margin-bottom: 2em;
                }

                .header-left {
                    font-size: inherit;
                    line-height: 1.4;
                    min-width: 120px;
                }

                .diary-header-center {
                    text-align: center;
                    flex: 1;
                }

                .diary-header-center span {
                    display: block;
                }

                .diary-header-center span:first-child {
                    font-size: 1.5em;
                }

                .case-number {
                    font-size: inherit;
                    font-weight: bold;
                    margin-bottom: 2px;
                }

                .rule-number {
                    font-size: inherit;
                }

                .header-right {
                    min-width: 120px;
                }

                .underline-field {
                    display: inline-block;
                    min-width: 80px;
                    border-bottom: 1px dotted #333;
                    text-align: center;
                    margin: 0 4px;
                }

                .against-section {
                    text-align: right;
                    margin-bottom: 8px;
                }

                .vs-text {
                    margin: 0 10px;
                }

                .special-report {
                    text-align: right;
                    margin-bottom: 2em;
                }

                .case-details {
                    font-size: inherit;
                    line-height: 1.8;
                }

                .case-details span {
                    margin-right: 15px;
                }

                .diary-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                    page-break-inside: auto; /* Allow table to break across pages */
                }

                .diary-table th,
                .diary-table td {
                    border: none;
                    padding: 8px;
                    vertical-align: top;
                }

                .left-column {
                    width: 28%;
                    border-right: 1px solid #000 !important;
                }

                .right-column {
                    width: 72%;
                }

                .table-header th {
                    background: #f5f5f5;
                    font-weight: bold;
                    text-align: center;
                    page-break-after: avoid;
                    border-top: 1px solid #000;
                }

                .diary-table tr:nth-child(2) td {
                    border-top: 1px solid #000 !important;
                }

                .content-area {
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-size: inherit;
                    line-height: 1.6;
                    min-height: 0; /* Remove fixed height to allow natural flow */
                }

                /* Print-specific optimizations */
                @media print {
                    body { 
                        margin: 10mm 5mm 10mm 5mm !important; /* Use mm for print */
                        background: #fff;
                    }
                    
                    /* Remove any container margins for print to let @page work */
                    .page-container {
                        margin: 0 !important;
                    }
                    
                    /* Let browser handle page breaks naturally */
                    .diary-table {
                        page-break-inside: auto;
                    }
                    
                    .diary-header {
                        page-break-after: avoid;
                    }
                    
                    .table-header {
                        page-break-after: avoid;
                    }

                    /* Ensure rich text formatting prints correctly */
                    .letter-content strong,
                    .letter-content b {
                        font-weight: bold !important;
                    }

                    .letter-content em,
                    .letter-content i {
                        font-style: italic !important;
                    }

                    .letter-content u {
                        text-decoration: underline !important;
                    }

                    .letter-content s,
                    .letter-content strike {
                        text-decoration: line-through !important;
                    }

                    .letter-content blockquote {
                        border-left: 4px solid #ccc !important;
                        margin: 0 0 1em 0 !important;
                        padding-left: 1em !important;
                        font-style: italic !important;
                    }

                    .letter-content h1,
                    .letter-content h2 {
                        font-weight: bold !important;
                        margin: 1em 0 0.5em 0 !important;
                    }

                    .letter-content ul,
                    .letter-content ol {
                        margin: 0.5em 0 !important;
                        padding-left: 2em !important;
                    }

                    /* Quill size classes for print */
                    .letter-content .ql-size-small {
                        font-size: 0.75em !important;
                    }

                    .letter-content .ql-size-large {
                        font-size: 1.5em !important;
                    }

                    .letter-content .ql-size-huge {
                        font-size: 2.5em !important;
                    }
                }

                /* Screen preview styles */
                @media screen {
                    .page-container {
                        border: 1px solid #ccc;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        margin-bottom: 20px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="page-container">
                ${content}
            </div>
        </body>
        </html>
    `,

    // Diary header with proper structure
    diaryHeader: (data) => `
        <div class="diary-header">
            <div class="header-top">
                <div class="header-left">
                    <div>अनुसूची 47, प सं0 120 अ</div>
                    <div>आ0 ह0 प सं0 30 अ</div>
                </div>
                <div class="diary-header-center">
                    <span>केस-दैनिकी सं0 <strong class="underline-field">${data.case_diary_no || ''}</strong></span>
                    <span>(नियम- <strong class="underline-field">${data.rule_no || ''}</strong>)</span>
                </div>
            </div>
            
            <div class="against-section">
                <span>आरोपी <strong class="underline-field">${data.against_1 || ''}</strong></span>
                <span class="vs-text">बनाम</span>
                <span>आरोपी <strong class="underline-field">${data.against_2 || ''}</strong></span>
            </div>
            
            <div class="special-report">
                <span>विशेष रिपोर्ट केस सं. <strong class="underline-field">${data.special_report_no || ''}</strong></span>
            </div>
            
            <div class="case-details">
                <span>थाना <strong class="underline-field">${data.thana || ''}</strong></span>
                <span>जिला <strong class="underline-field">${data.district || ''}</strong></span>
                <span>प्रथम इत्तिला रिपोर्ट सं. <strong class="underline-field">${data.fir_number || ''}</strong></span>
                <span>तिथि <strong class="underline-field">${data.fir_date || ''}</strong></span>
                <span>घटना की तिथि और स्थान <strong class="underline-field">${data.event_date_place || ''}</strong></span>
                <span>धाराः <strong class="underline-field">${data.sections || ''}</strong></span>
            </div>
        </div>
    `,

    // Diary table that flows naturally
    diaryTable: (data) => `
        <table class="diary-table">
            ${data.showHeader ? `
            <tr class="table-header">
                <th class="left-column">किन तिथि को (समय सहित )<br>कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया |</th>
                <th class="right-column">अन्वेषण का अभिलेख <strong class="underline-field">${data.investigation_record || ''}</strong></th>
            </tr>
            ` : ''}
            <tr>
                <td class="left-column">
                    <div class="content-area">${data.left_box || ''}</div>
                </td>
                <td class="right-column">
                    <div class="content-area">${data.right_box || ''}</div>
                </td>
            </tr>
        </table>
    `,

    // Letter content
    letterContent: (data) => `
        <div class="letter-content">${data.letter_content}</div>
    `
};