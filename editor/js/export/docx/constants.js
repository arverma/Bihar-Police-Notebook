/**
 * Page geometry and typography shared by the DOCX mappers.
 * Word measures in twips (1/20 pt); the editor measures in CSS px (1px = 15 twips).
 */

export const TWIPS_PER_PX = 15;
export const EMU_PER_PX = 9525;

/** A4 with the editor's 12.7mm (0.5in) margins. */
export const PAGE = { width: 11906, height: 16838, margin: 720 };
export const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;

/** Diary columns: left 20%, right 80% (LEFT_COL_PCT in the editor). */
export const LEFT_COL_PCT = 20;

/** Word's default left+right cell padding (108 twips each side). */
export const CELL_PADDING = 216;

/** Same family as the editor; Word substitutes a Devanagari font when absent. */
export const FONT_NAME = 'Noto Sans Devanagari';
export const FONT = { ascii: FONT_NAME, hAnsi: FONT_NAME, cs: FONT_NAME, eastAsia: FONT_NAME };

/** 16px text, in half-points. */
export const FONT_SIZE = 24;
/** Editor line height is 24px for 16px text (1.5×); 240 = single in "auto" line rule. */
export const LINE_SPACING = 360;

