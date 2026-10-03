# Word export — manual test checklist

Run after any change to `editor/js/export/docx/`, or after bumping `docx`. The automated tests assert on the generated XML; only a person can judge how **Word** (and Pages / LibreOffice) renders it.

## Setup

- Microsoft Word (desktop) — the reference. Repeat the file-opens-cleanly check in LibreOffice and Pages if you have them.
- A diary with: a header on page 1 and page 3, three or more pages of right-column text with a numbered list and a table that cross a page edge, a left-column note, a bold / italic / underlined / justified paragraph, and a photo resized to ~50 %.
- A letter with a long paragraph that crosses a page edge.

## Cases

1. **Opens cleanly** — Download from a History row. Word opens it with no "unreadable content / repair" prompt.
2. **Row choice** — Export a row that is *not* open. The file holds that document's text, and the editor did not switch documents.
3. **Open document is live** — Type a word, immediately export the open row (within a second). The word is in the file.
4. **Hindi text** — Hindi and English render; bold, italic and underline apply to **both** scripts; the font is Noto Sans Devanagari, or a Devanagari fallback if it is not installed.
5. **Header** — Fields, the date as dd/mm/yyyy, and the column titles are present. Page 3's header starts a new Word page; page 1's does not add a blank page first.
6. **Two columns** — Left ≈ 20 %, right ≈ 80 %, borders drawn. Left notes sit in the same row as the right text of that editor page.
7. **Long right column** — A row that overflows a Word page continues on the next; no text is cut off.
8. **List and table** — The numbered list keeps its numbering across the page edge; the table's header row repeats; cell merges are intact.
9. **Image** — About half the column width, not stretched; alt text present (Right-click → View Alt Text).
10. **Letter** — The long paragraph is one paragraph (click into it: no break at the old page edge).
11. **Editing** — Type in the middle of a paragraph, add a row to the table, change a font size: Word behaves normally.
12. **Empty and unsupported** — A blank document shows "Cannot export empty document!". An "Older format" row has no Word button.
13. **Phone** — On iPhone / iPad the share sheet offers Save to Files / Pages; on Android the file downloads.
14. **Warnings** — A document with content the exporter simplifies shows one alert listing it, after the file is saved.

## Pass criteria

Cases 1–11 pass in Word. Cases 12–14 pass on the devices you have. File any rendering difference you notice, even a cosmetic one — it is a candidate for the "Known limits" list in [Word export](../components/word-export.md).
