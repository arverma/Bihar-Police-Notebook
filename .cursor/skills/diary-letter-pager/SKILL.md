---
name: diary-letter-pager
description: >-
  Diary/letter A4 pagination on the Tiptap/ProseMirror document editor: spill,
  absorb, cut paragraphs (cont), page-edge keys, caret across pages, clip
  prevention, header node view, print-clone parity. Use when editing
  editor/js/editor/ (pager, schema, page views, structure), diary-sheet,
  letter-sheet, the diary-pagination / navigation / undo / print-parity tests,
  or when the user reports clipping, caret jumps, Enter/Backspace at page
  edges, welded lines, or pagination bugs.
---

# Diary / letter pager

## When this applies

Any change to how pages are laid out or edited: the pager, the document
schema, page node views (diary header), page-edge keys, selection rules,
transliteration/dictation hooks into the editor, or the print clone.

Read [`reference.md`](reference.md) for module roles and invariants. Product
notes: [`docs/components/templates.md`](../../../docs/components/templates.md).
Manual checklist:
[`docs/manual-tests/diary-pagination.md`](../../../docs/manual-tests/diary-pagination.md).

## Hard constraints

1. **One editor per document.** Pages are nodes (`letterPage` / `diaryPage`), each with fixed-height `flowCell`s. Never mount a second editor per page or move text through the DOM.
2. **Only the pager moves text between pages**, in transactions tagged `bpPaginate`. Only continuations (`cont`) are ever re-joined; separate paragraphs never are. Opening a document repairs overflow but never absorbs.
3. **Edits stay inside one cell.** Selections are clamped to one page's cell and the structure guard drops transactions that cross cells. Page add/delete/header toggle are `bpStructure` transactions.
4. **Never write to DOM that ProseMirror manages.** Per-node state goes through decorations or a node view's own outer element (`--diary-box-h`); the editor root is the only element whose attributes ProseMirror ignores (`data-bp-pager`).
5. **Print stays live-clone** (`editor/js/export/print-document.js`) with the same stylesheets; text layout lives on `.bp-cell`. Do not build a second layout for PDF.
6. **Import Tiptap/ProseMirror only via `editor/js/editor/tiptap.js`** (the vendored single bundle). Rebuild with `npm run vendor:tiptap` after changing pinned versions.

## Workflow for pager bugs / features

1. Reproduce with translit **OFF** unless the bug is Hinglish-specific.
2. Prefer TDD: pure document operations get a unit test in `editor/js/editor/pager/ops.test.js` or `structure.test.js` (real schema via `test-helpers.js`); behaviour in the browser gets an e2e test in `tests/diary-pagination.spec.js` using `tests/pagination-helpers.js` (`setDoc`, `setCaret`, `settle`, `columnBlocks`, `columnPages`, `clippedBoxes`, `caret`). Drive typing with real key presses.
3. Fix the smallest layer: `pager/measure.js` (geometry reads) → `pager/ops.js` (transaction builders) → `pager/plugin.js` (scheduling, suspension, history) → `structure.js` (keys, selection) → `page-views.js` (header, chrome).
4. Verify: `npm test` and `make test-e2e`. Every e2e pagination test also asserts the pager never hit its loop cap.
5. **Playwright browsers (Cursor agents):** prefer `make test-e2e`, which handles both agent-shell quirks on macOS — it forces `PLAYWRIGHT_BROWSERS_PATH` to the user’s install (the agent shell points it at an empty sandbox cache) and sets `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` when `os.cpus()` is empty, since Playwright reads Apple Silicon from `os.cpus()` and otherwise resolves a `chrome-mac-x64` build that was never downloaded. Do **not** run `npx playwright install` to work around either. Chromium still segfaults inside the sandbox, so run e2e with full permissions:
   ```bash
   PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
   PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="mac$(sw_vers -productVersion | cut -d. -f1)-arm64" \
     npx playwright test tests/diary-pagination.spec.js tests/print-parity.spec.js
   ```
6. **Always verify in Cursor browser:** list open tabs; if the app is not already open, start the local server (`make serve`) and navigate to it (typically `http://localhost:8080/`). Lock the tab, reproduce the case (typing at a page bottom, Enter/Backspace at edges, blank lines, header edits, print clone), then unlock. Do not skip this when Playwright browsers are unavailable.
7. Update the manual checklist / templates.md only if behaviour or invariants changed.

## Anti-patterns

- Measuring with `scrollHeight` / `clientHeight` alone — compare viewport rects, scaled by the cell's own `rect.height / offsetHeight`.
- Running the pager inside `appendTransaction` (no DOM yet) or during IME composition.
- Mapping a moved caret with plain `tr.mapping` — use the explicit remap in `ops.js` / `mapThroughPager`.
- Pager transactions with `addToHistory: false` after a user edit — undo would lose the edit; they are merged into its undo step instead.
- Joining blocks on absorb without checking `cont`.
- Setting attributes or styles directly on cells or paragraphs (ProseMirror re-renders them away).
