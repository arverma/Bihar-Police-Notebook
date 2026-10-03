/**
 * The diary page header (page attrs `fields`) as a bordered Word table,
 * laid out like the on-screen form, plus the column-titles row that opens
 * the body table of a header page.
 *
 * Labels are the form's own Hindi text (editor/index.html #diaryPageTemplate).
 */
import { Paragraph, Table, TableRow, TableCell, WidthType, TableLayoutType, AlignmentType } from '../../../vendor/docx/docx.esm.js';
import { inlineRuns } from './inline.js';
import { TABLE_BORDERS } from './blocks.js';
import { CONTENT_WIDTH, LINE_SPACING } from './constants.js';
import { formatHeaderDate } from '../../editor/diary-geometry.js';

const NO_WARN = { warn() {} };
const val = (fields, k) => String(fields?.[k] ?? '').trim();

/** One line of runs; `parts` mixes plain strings and `{ b: text }` for bold. */
function line(parts, opts = {}) {
    const content = parts.flatMap((p) => {
        const text = typeof p === 'string' ? p : p.b;
        if (!text) return [];
        return [{ type: 'text', text, marks: typeof p === 'string' ? [] : [{ type: 'bold' }] }];
    });
    return new Paragraph({
        children: inlineRuns(content, NO_WARN),
        alignment: opts.alignment,
        spacing: { line: LINE_SPACING, after: 0 },
        pageBreakBefore: opts.pageBreakBefore,
    });
}

function cell(paragraphs, width, columnSpan) {
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        columnSpan,
        children: paragraphs,
    });
}

/** Label followed by its value, e.g. "थाना  <thana>"; empty values keep the label. */
const field = (label, value) => [`${label} `, { b: value }, '   '];

/**
 * @param {Record<string, string>} fields page header fields
 * @param {{ pageBreakBefore?: boolean }} [opts]
 */
export function headerBlock(fields, { pageBreakBefore = false } = {}) {
    const third = Math.floor(CONTENT_WIDTH / 3);
    const widths = [third, third, CONTENT_WIDTH - 2 * third];

    const top = new TableRow({
        children: [
            cell([
                line(['अनुसूची 47, प्रपत्र सं० 120 अ'], { pageBreakBefore }),
                line(['आ० ह० प्रपत्र सं० 30 अ']),
            ], widths[0]),
            cell([
                line(['केस-दैनिकी सं० ', { b: val(fields, 'case_diary_no') }], { alignment: AlignmentType.CENTER }),
                line(['(नियम-164)'], { alignment: AlignmentType.CENTER }),
            ], widths[1]),
            cell([
                line([{ b: val(fields, 'against_1') }, ' बनाम ', { b: val(fields, 'against_2') }]),
                line(['विशेष रिपोर्ट केस सं० ', { b: val(fields, 'special_report_no') }]),
            ], widths[2]),
        ],
    });
    const meta = new TableRow({
        children: [cell([line([
            ...field('थाना', val(fields, 'thana')),
            ...field('जिला', val(fields, 'district')),
            ...field('प्रथम इत्तिला रिपोर्ट सं०', val(fields, 'fir_number')),
            ...field('तिथि', formatHeaderDate(fields?.fir_date)),
        ])], CONTENT_WIDTH, 3)],
    });
    const event = new TableRow({
        children: [cell([line([
            ...field('घटना की तिथि और स्थान', val(fields, 'event_date_place')),
            ...field('धारा', val(fields, 'sections')),
        ])], CONTENT_WIDTH, 3)],
    });

    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        borders: TABLE_BORDERS,
        rows: [top, meta, event],
    });
}

/** First row of a header page's body table: the two column titles. */
export function titlesRow(fields, leftWidth, rightWidth) {
    return new TableRow({
        cantSplit: true,
        children: [
            cell([line([{ b: 'किन तिथि को (समय सहित) कार्रवाई की गई, और किन-किन स्थानों को जाकर देखा गया' }])], leftWidth),
            cell([line([{ b: 'अन्वेषण का अभिलेख ' }, { b: val(fields, 'investigation_record') }], { alignment: AlignmentType.CENTER })], rightWidth),
        ],
    });
}
