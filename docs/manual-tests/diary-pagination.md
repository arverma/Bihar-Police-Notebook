# Diary / letter pagination — manual test checklist

Run locally after any pager or editor change, before deploying. Automated coverage is in `tests/diary-pagination.spec.js`, `diary-navigation`, `diary-undo` and `print-parity`; this list covers what only a person (or a real device) can judge.

## Setup

- Desktop Chrome, transliteration toggle **OFF** for clip/caret cases; **ON** for the Hinglish case.
- Diary template, new document.
- Confirm page preview scale is default (fit).
- Real devices for the last section: an Android phone with Gboard and an iPhone/iPad.

## Cases

1. **Pipe after backspace** — Type a Hindi word (or Latin with translit off), Backspace once, type `|`, Space. The `|` must remain.
2. **Justified end-of-line** — Format a paragraph Justify. Click near the end of a wrapped line under scaled preview. Caret lands on the intended character.
3. **Paste large block** — Paste ~2 pages of Hindi into the right column. No box clips; extra pages appear; "Page X of Y" updates.
3b. **Paste fills remaining lines** — With page 1 nearly full, paste one long Hindi paragraph. It starts on page 1 (filling the free lines) and only the overflow continues on page 2.
3c. **Aligned spill** — Justify or Center a long paragraph and let it overflow. Page 2 continues it as one paragraph with the same alignment.
3e. **Enter on aligned paragraph** — Enter near the bottom of an aligned paragraph so text moves to page 2. Leading blank lines on page 2 are fine; no empty lines between continuation lines.
4. **Enter at bottom of full page** — Enter several times on the last line. Blank lines move to the next page; the caret follows; the stage does not jump.
5. **Both columns** — Fill the left column past one page while the right stays short (and the reverse). Each column continues on its own; the other column is untouched.
6. **Backspace at start of page 2** — On a separate paragraph: it joins onto page 1's last line, caret at the junction. On a cut paragraph: the character before the page edge is deleted.
6c. **Pulled lines stay separate** — Fill page 1 with numbered lines; Enter four lines from the bottom; Backspace once. Lines come back one per line — never welded (`29303132`).
7. **Arrows across pages** — ↑ / ↓ / ← / → at a page edge move to the same column on the neighbouring page, keeping the horizontal position for ↑ / ↓.
8. **Hinglish suggestion near a page edge** — Translit ON, type a Roman word on the last line until suggestions appear, pick one (or Space), then keep typing. Text spills once the suggestion closes; caret follows the text.
9. **Header** — Type in थाना, FIR number, धारा (wraps to two lines). The writing boxes shrink by whole lines and text below spills; the FIR number becomes the document name. Ctrl+Z in a header field undoes the whole word.
10. **Header toggle** — Hide / Show header on a full page: text spills or pulls back; the caret stays on its line.
11. **Blank lines** — Press Enter several times on the last page. Blanks survive moving to another page, reload, and PDF.
12. **Undo/redo across pages** — Type on page 1, click page 2, Ctrl+Z: page 1's edit is undone and the caret returns there. Paste that creates page 2: one Ctrl+Z per step returns to one page; Ctrl+Shift+Z restores.
13. **Lists** — A numbered list that crosses a page edge keeps counting on the next page.
13b. **Tables** — Insert a table (toolbar), type with Tab between cells, keep pressing Tab in the last cell until it crosses the page. It is cut between rows, page 2 repeats the header row, nothing clips. Add a column from page 2: page 1 gets it too. Turn the header row off: the repeat disappears. Delete table from page 2: every piece goes; Ctrl+Z brings it back. PDF shows the repeated header.
13c. **Images** — Insert a phone photo (toolbar → camera / gallery on a phone). It appears at the caret, scaled to the column. Select it, drag the corner handle, and Alt+←/→: the width changes and survives reload and PDF; Ctrl+Z undoes one resize at a time. Paste a screenshot; drop a file from the desktop. A very tall image never exceeds one box.
14. **Older-format documents** — With an old document in History: it shows "Older format"; clicking it offers Delete / Keep; Escape keeps it.

## Real devices

- **Android (Gboard):** type Hindi and English words at a page bottom. Composition is never interrupted (no doubled or lost characters); the page spills when the word is committed. Backspace at the top of page 2 behaves as case 6.
- **iOS / iPadOS:** PDF export produces every page (raster path); Hindi text and header fields render; no "Page X of Y" footer in the PDF.

## Pass criteria

- No clipped writing box after any case; red outlines (`data-overflow`) appear only for a single item taller than a whole box.
- The caret is always visible where typing happens, and the stage never scrolls by itself.
- Reloading a document keeps its pages exactly as saved.
- Moving text between pages never changes the text: no lost, doubled or welded characters or lines.
- What you see on screen (blank lines, alignment, line breaks) is what print / PDF shows.
