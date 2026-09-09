# Diary / letter pagination — manual test checklist

Run locally after any pager change, before deploying. Continuous-right (one live Quill on the focused diary page) and static fit + live peel are always on. Storage stays `pages[]`. Left column stays a plain textarea.

## Setup

- Desktop Chrome, transliteration toggle **OFF** for clip/caret cases; **ON** for the Hinglish case.
- Diary template, new document.
- Confirm page preview scale is default (fit).

## Cases

1. **Pipe after backspace** — Type a Hindi word (or Latin with translit off), Backspace once, type `|`, Space. The `|` must remain.
2. **Justified end-of-line** — Format a paragraph Justify. Click near the end of a wrapped line under scaled preview. Caret should land on the intended character (not a neighboring line).
3. **Paste large block** — Paste ~2 pages of Hindi into the right column. No page may clip (top lines hidden / `scrollTop > 0`). Extra pages appear as needed.
3b. **Paste fills remaining lines** — With page 1 nearly full (~1 line of slack), paste one long Hindi paragraph. The start of that paragraph must stay on page 1 (fill remaining lines); only the overflow continues on page 2. No clip.
3c. **Aligned paste / format-then-spill** — Paste (or type) a long paragraph, apply **Justify** or **Center**, and let it overflow onto page 2. Page 2 must wrap as a normal paragraph (same alignment) — not one word per line. Unformatted spill should still look the same as before.
3d. **Format then type past the edge** — On a nearly full page, Justify (or Center) the last paragraph, then type until text spills. Page 2 continuation stays one multi-word paragraph with that alignment; no clip.
3e. **Enter on aligned paragraph** — With an aligned (justify / center / right) paragraph filling toward the page edge, press Enter near the bottom so blanks and text move to page 2. Leading blank lines on page 2 are OK; there must be **no empty line between continuation text lines** (no sparse / gappy column).
4. **Enter at bottom of full page** — Fill page 1, caret on last line, press Enter several times. New blank lines move to the next page; page 1 must not clip from the top. The stage (`main.main-content`) must not jump — only manual scroll moves it.
5. **Enter at start of last line (right)** — Fill until the last visible line is a short sentence. Caret at the start of that sentence, Enter. Content spills to the next page; no top clip.
5b. **Enter after absorb to-and-fro** — Fill 2+ pages, delete near the end of page 1 so text absorbs back from page 2, then Enter mid-page (or at an empty line). Bottom text must spill to the next page — not hide under the clip. Repeat a couple of times.
6. **Backspace at start of page 2** — With a short line on page 2 right column, caret at start, Backspace. Line merges into page 1; caret stays at the start of that merged line and stays visible.
6b. **Backspace pulls mid-paragraph** — After 3b (spilled long paragraph), caret at start of page 2, Backspace. Text pulls back onto page 1 when slack exists; page 1’s ending is **not** eaten while page 2 stays unchanged. If page 1 is truly full, delete-on-prev still applies.
6c. **Pulled lines stay separate lines** — Fill page 1 with short numbered lines (`1`…`n`). Caret at the start of the 4th line from the bottom, Enter four times so the last four lines move to page 2, then Backspace once. Those lines come back one per line — never welded onto one line (`29303132`).
7. **Left Enter then Backspace** — Fill left column past one page. Enter at the start of a known line so it spills; Backspace once. That line returns to page 1; no clip.
8. **Hinglish suggestion + Enter** — Translit ON, type a Roman word until suggestions appear, pick one (or Space), then Enter near a page boundary. No clip; caret follows the text.
9. **Click another page’s right column** — With multi-page content, click a static (non-focused) right column. Live Quill moves there; caret is usable.
10. **Blank lines survive page switch + PDF** — On the last right page, type some text then press Enter several times so blank lines are visible. Click another page’s right column. The now-static last page must still show those blank lines (not collapse). Export PDF / print preview must match what you see — blanks are not trimmed.
11. **Undo after page switch** — Type on page 1 right column, then click page 2’s right column. Ctrl+Z (Cmd+Z on Mac) must restore page 1’s text and move the live Quill/caret back. Undo is document-scoped, not tied to the focused page’s Quill instance.
12. **Undo/redo paste spill** — Paste enough into a nearly-full page to create page 2. Ctrl+Z collapses back to one page (paste gone). Ctrl+Shift+Z (Cmd+Shift+Z) restores the two-page state. No clip after either step.
13. **Paste mid-page then ArrowDown** — With a full page of lines, paste a long Hindi paragraph after line ~22. Overflow must spill to page 2. Pressing ↓ must not scroll the right box (`scrollTop` stays 0) — no jump in visible line numbers / clipped top.

## Pass criteria

- No clipped column boxes after any case.
- Caret always visible where typing happens.
- Reload the document: healthy multi-page docs keep the same page count; previously overflowing single-page blobs get an extra page (open repair).
- Absorb pulls line / block / **in-paragraph text fragment** units into slack (including when slack appears on an earlier page); it does not wholesale re-cut the whole column, and it never joins two of the user’s lines into one.
- Boundary Backspace on the right column tries **absorb-first**; only if nothing moves does it delete the previous page’s last character.
- Blank lines typed by the user remain after blur/page switch and in PDF (WYSIWYG).
- Session undo/redo (Ctrl/Cmd+Z / Shift+Z) survives page switches and paste-spill; it is not cleared by continuous-right remounts.
- Fixed diary boxes never use `scrollTop > 0` to reveal the caret — overflow spills instead.
