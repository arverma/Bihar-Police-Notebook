---
name: diary-letter-pager
description: >-
  Diary/letter A4 pagination: spill, absorb, continuous-right Quill, page-fit,
  caret across pages, clip prevention, print-clone parity. Use when editing
  diary-sheet, letter-sheet, quill-pages, page-fit, diary-pagination tests, or
  when the user reports clipping, caret loss, Enter/Backspace at page edges,
  justify-under-scale, or pagination bugs. Do not invent schema migrations.
---

# Diary / letter pager

## When this applies

Any change to diary/letter page reflow, Quill right column, left textarea spill,
fit measurement, caret restore, or pagination e2e / manual tests.

Read [`reference.md`](reference.md) for invariants and anti-patterns. Manual
checklist:
[`docs/manual-tests/diary-pagination.md`](../../../docs/manual-tests/diary-pagination.md). Product
notes: [`docs/components/templates.md`](../../../docs/components/templates.md).

## Hard constraints (never violate)

1. **Storage stays `pages[]`.** Diary JSON is `{ pages: [{ hasHeader, header, left, right }, ...] }` via `normalizeDiaryModel`. No `rightStream` (or similar) in IndexedDB/Drive. No migration for pager work.
2. **Print stays live-clone** (`editor/js/export/print-document.js`). Do not invent a second layout for PDF.
3. **Left column stays a plain textarea** — not Quill.
4. **Do not** rewrite on canvas, OnlyOffice, Paged.js-as-editor, or ProseMirror for this domain unless the user explicitly abandons Quill.
5. **Do not re-cut healthy docs on open.** Open-repair only when a slice overflows the live box; healthy multi-page slices keep page count and content.

## Runtime architecture (shipped)

- **Continuous-right (always on):** one live Quill on the focused diary page; other right hosts are static HTML clones of `pages[].right`. Click static → `activateRightPage`. `getModel()` still returns `pages[]` only.
- **Fit:** `splitRichToFit` → static probe (`page-fit.js`, including mid-paragraph `P`/`DIV` text split), then **live peel** (`peelUntilLiveFits`) until the real box fits.
- **Overflow:** `scrollHeight > clientHeight + 1` **or** `scrollTop > 0`. After setContent / static fill, force `scrollTop = 0`.
- **Spill:** forward cascade; double-rAF recheck **all** pages for that column (Enter after absorb can lag `scrollHeight`).
- **Absorb:** one plain line (left) or one top-level HTML block **or fitting in-paragraph text prefix** (`P`/`DIV`) on the right into slack (`absorbAround` / `absorbIntoPrev`) — including pulling from page N+1 into page N when earlier page gains slack. **Not** greedy join+full resplit of the whole column. **Absorb must never change the block sequence:** merging page N+1’s first block into page N’s last block (`fitMergeIntoLastBlock`) is only for a paragraph this pager cut, so it requires the merge to grow the box by a line. Filling leftover width on an already-complete line welds separate paragraphs (`29 30 31 32` → `29303132`).
- **Boundary Backspace (right):** try **absorb-first** (fine-grained) into page N−1 without deleting; if nothing moved, delete last char of prev then absorb. Caret restores at the junction (absorb-first) or `globalAtJunction - 1` (delete path).
- **Caret:** global offset via `caretToGlobal` / `caretFromGlobal` / `caretJunctionCost`. Right: `caretIndexAfterTextChange` from text-change delta (selection is stale). Skip reflow while `isComposing` or Hinglish suggestions own the word; `compositionend` reflows once. `restoreCaretGlobal`: `setSelection(..., 'api')` — never `quill.focus()` first. **Do not auto-scroll the stage on caret restore** (Quill’s `scrollSelectionIntoView` is no-op’d on mount; reflow freezes `main.main-content` scroll; user scrolls explicitly). `collapseTrailingEmptyPages(pages, keepIndex)` keeps the caret-owned page so Enter-spill blanks survive.
- **Justify:** `caretRangeFromPoint` after `scaledClientToLayoutPoint` for `--page-scale`. Keep justify for print.
- **Blank lines are content** (`getQuillHtmlPreservingBlanks`). Do not collapse occupied blank `<p>`s away during spill/collapse. Serialize from live `root.innerHTML` (not `getSemanticHTML()`), then `sanitizeQuillHtml` so empty blocks stay canonical `<p><br></p>` for static clones, fit probes, and print/PDF.

## Workflow for pager bugs / features

1. Reproduce with translit **OFF** unless the bug is Hinglish-specific.
2. Prefer TDD: extend [`tests/diary-pagination.spec.js`](../../../tests/diary-pagination.spec.js) + [`tests/pagination-helpers.js`](../../../tests/pagination-helpers.js) (`clippedDiaryBoxes`, `installDiaryQuillHelper`, `fillSinglePage`). Interact through `window.__q(i)`; **assert** through `window.__liveQ(i)` — see the harness traps in `reference.md` before writing a caret or geometry assertion.
3. Fix the smallest layer: `page-fit.js` (units/measure) → `quill-pages.js` (Quill/fit/scrollTop) → `diary-sheet.js` (spill/absorb/continuous-right).
4. Verify: `npm test` and `make test-e2e` (or the Playwright commands below).
5. **Playwright browsers (Cursor agents):** prefer `make test-e2e`, which handles both agent-shell quirks on macOS — it forces `PLAYWRIGHT_BROWSERS_PATH` to the user’s install (the agent shell points it at an empty sandbox cache) and sets `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` when `os.cpus()` is empty, since Playwright reads Apple Silicon from `os.cpus()` and otherwise resolves a `chrome-mac-x64` build that was never downloaded. Do **not** run `npx playwright install` to work around either. Chromium still segfaults inside the sandbox, so run e2e with full permissions:
   ```bash
   PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
   PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac26-arm64 \
     npx playwright test tests/diary-pagination.spec.js tests/print-parity.spec.js
   ```
6. **Always verify in Cursor browser:** list open tabs; if the app is not already open, start the local server if needed and navigate to it (typically `http://localhost:8080/`). Lock the tab, reproduce the case (page switch, Enter/Backspace at edges, blank lines, print clone), then unlock. Do not skip this when Playwright browsers are unavailable.
7. Update the manual checklist / templates.md only if behavior or invariants changed.

## Anti-patterns

- Quill offscreen mirror with `setNativeRange`/`focus` stubs for fit (removed — use static + live peel).
- Prefs kill-switches for continuous-right / static fit (removed — always on).
- Magic pixel reserves instead of live-box agreement.
- `getSelection()` inside `text-change` for post-type caret.
- Treating `columnTextLength` as caret math (use caret helpers).
- Converting left column to Quill “for simplicity.”
- Dual schema or storing a parallel stream field.
