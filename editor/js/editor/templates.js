/**
 * Page templates: how the pager builds a new page for each document kind.
 * See PageTemplate in ./pager/ops.js.
 */
import { emptyHeader } from './diary-geometry.js';

/** @type {import('./pager/ops.js').PageTemplate} */
export const letterTemplate = {
    name: 'letter',
    columns: ['main'],
    createPage(schema, content) {
        const { flowCell, paragraph, letterPage } = schema.nodes;
        const cell = flowCell.create({ col: 'main' }, content.main ?? paragraph.create());
        return letterPage.create(null, cell);
    },
    isRemovable: () => true,
};

/** @type {import('./pager/ops.js').PageTemplate} */
export const diaryTemplate = {
    name: 'diary',
    columns: ['left', 'right'],
    createPage(schema, content) {
        const { flowCell, paragraph, diaryPage } = schema.nodes;
        const cell = (col) => flowCell.create({ col }, content[col] ?? paragraph.create());
        // Continuation pages carry no header, like a blank sheet in the register.
        return diaryPage.create({ hasHeader: false, fields: emptyHeader() }, [cell('left'), cell('right')]);
    },
    // A page whose header the user switched on is kept even when empty.
    isRemovable: (page) => !page.attrs.hasHeader,
};
