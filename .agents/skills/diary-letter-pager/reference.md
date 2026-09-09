# Diary / letter pager — reference

Derived from the long-term pager roadmap and live-fit/absorb hardening in this repo.

## Key files

| File | Role |
|------|------|
| `editor/js/diary-sheet.js` | Diary model, continuous-right, spill/absorb, caret global, open repair |
| `editor/js/page-fit.js` | Static measure; `takeFirstContentUnit` / `peelLastContentUnit` / `splitBlockTextToFit` / `takeFittingHtmlPrefix`; `splitRichToFitStatic` |
| `editor/js/quill-pages.js` | Quill mount, `splitRichToFit`, `editorFits` (+ scrollTop), justify scale, caret-from-delta |
| `editor/js/letter-sheet.js` | Letter pages; caret-from-delta + composition skip (parity with diary) |
| `editor/js/prefs.js` | Dictation prefs only — **no** pager kill-switches |
| `editor/js/export/print-document.js` | Live-clone print source of truth |
| `tests/diary-pagination.spec.js` | Pager e2e |
| `tests/pagination-helpers.js` | `clippedDiaryBoxes`, `installDiaryQuillHelper` |
| `docs/manual-tests/diary-pagination.md` | Manual checklist |
| `docs/components/templates.md` | Human-facing architecture notes |

## Playwright browser cache (agents)

Cursor agent shells often set `PLAYWRIGHT_BROWSERS_PATH` to a throwaway sandbox directory. Use the host cache instead of reinstalling:

- macOS default: `$HOME/Library/Caches/ms-playwright`
- `make test-e2e` exports that path on Darwin
- Host one-time install: `npx playwright install chromium`

## Persistence contract

```text
{ pages: [ { hasHeader, header, left, right }, ... ] }
```

- Load via `normalizeDiaryModel` (also migrates legacy flat `left_box` / `right_box`).
- Autosave, History, Drive, print all see this shape.
- Rollback of editor code never requires rewriting stored HTML.

## Continuous-right

- `activeRightPageIndex`: only that page mounts live Quill (`mountLiveRight`).
- Others: `fillStaticRight` (contenteditable=false `.ql-editor`).
- `activateRightPage` syncs HTML from live fields, static-fills others, mounts target.
- Letter may still use per-page Quill; diary is the continuous-right path.

## Blank-line HTML contract

- Canonical empty block = `<p><br></p>` (same for empty `LI` / `DIV` if present).
- `getQuillHtmlPreservingBlanks` reads live `quill.root.innerHTML`, then `sanitizeQuillHtml` — never prefer `getSemanticHTML()` (it emits bare `<p></p>` because Break blot length is 0).
- `sanitizeQuillHtml` inserts `<br>` into empty allowlisted blocks and strips Quill caret chrome (`.ql-cursor` / `.ql-ui`).
- `fillStaticRight` sanitizes before inject so old stored `<p></p>` still shows as blank lines.
- WYSIWYG: blank lines visible on screen must survive page switch, reload, and print/PDF.

## Spill / absorb algorithms

**Spill**

1. Initial cut: left → live `splitOverflow` when textarea exists; right → `splitTextToFit` → static `splitRichToFit`.
2. `peelUntilLiveFits`: while live overflows, `peelLastContentUnit` from keep onto spill.
3. If still overflowing with empty spill, force peel at least one unit.
4. Cascade to following pages; `applyColumnAfterReflow`.
5. rAF (two frames): walk all pages; spill first overflowing index.

**Absorb**

1. `absorbIntoPrev(laterIndex)`: try whole `takeFirstContentUnit` from later page; if it overflows, on the **right** column take a fitting text prefix via `takeFittingHtmlPrefix` + `liveBoxFor` / `measureRichFits`. Stop when nothing fits.
2. `absorbAround(pageIndex)`: pull into prev; pull from next into current; cascade `absorbIntoPrev` for i = 1..n-1.
3. Boundary Backspace: **absorb-first** (caret at junction). If nothing moved, delete last char of previous page (activate prev Quill if static), then `absorbAround` with caret at `globalAtJunction - 1`.

Absorb is **not** undo of Enter and **not** join+binary-resplit of the entire joined column (that reshuffled cuts).

**Content units (right)**

- Default: top-level HTML block.
- Mid-paragraph: `P`/`DIV` may split by **text** (word boundary) for spill (`splitHtmlStatic` → `splitBlockTextToFit`), live peel (`peelLastContentUnit` trailing word), and absorb prefix. Lists/images stay whole-block. Inline marks may flatten across a split in v1.

## Absorb must preserve the block sequence

- Moving the page boundary may not change the document. The list of block texts across all pages (`rightColumnBlocks` in the e2e helpers) is invariant under spill/absorb.
- `fitMergeIntoLastBlock` merges page N+1's first block *into* page N's last block, which is only correct when the two are halves of one paragraph the pager cut. There is no marker for that: a `data-` attribute cannot survive Quill's Delta round-trip, and a model field would change the stored schema.
- Geometric stand-in: a cut always leaves the head's last line full, so a genuine continuation grows the box by a line. If one more character still fits on the current last line, the later block is a separate paragraph — refuse and let `splitBlockTextToFit` append it (or nothing) instead.
- Symptom when this is wrong: Enter above the last lines of a full page, then one Backspace at the top of page 2, and `29`/`30`/`31`/`32` come back as `29303132`.

## Collapse vs caret-owned blanks

- `isPageBodyEmpty` still treats a lone `<p><br></p>` as Quill default empty.
- `collapseTrailingEmptyPages(pages, keepIndex)` never pops a page at or before `keepIndex`, so Enter that spills a blank onto the next page keeps that page when the restored caret maps there.
- Reflow snapshots/restores `main.main-content` (or `#editorStage`) scroll; keyboard caret moves must not jump the stage.

## Overflow definition

A box clips when:

- `scrollHeight > clientHeight + 1`, or
- `scrollTop > 0` (Quill scrolled caret into a hidden top — classic Enter-on-full-page bug).

Fixed-height CSS uses `overflow: hidden` on `.bp-ql-editor` / `.fir-input` — clipping is silent unless tests check both.

## Caret math

- Left: character offsets in textarea values; junction cost 0 between pages for plain join.
- Right: Quill indices; page junctions cost one newline (`caretJunctionCost`); blank trailing `<p>` counts.
- Prefer `caretColumnLength` / `caretToGlobal` / `caretFromGlobal` over `columnTextLength` for selection restore.

## Translit interaction

- Hide suggestions **before** `replaceEditableRange` so diary reflow is not skipped (`translitOwnsInput`).
- Mid-composition: skip reflow; `compositionend` once.

## Justify × scale

- Clicks in justified blocks: map `clientX/Y` through `#editorScale` `--page-scale` (`scaledClientToLayoutPoint`), then `caretRangeFromPoint`.
- Never disable justify for print.

## E2E harness traps (diary-pagination)

- **`__q(i)` activates**; `__liveQ(i)` does not. Reading the caret with `__q` on a static page fires `activateRightPage`, which moves focus to that page and silently rewrites the answer. Use `__liveQ` in every assertion, `__q` only to interact.
- **A destroyed Quill stays registered on its container.** `Quill.find(staticHost)` returns an instance whose `root` was removed from the DOM, so every geometry read is `0`. Trust an instance only when `host.dataset.staticRight !== '1'` and `host.contains(q.root)`.
- **Slack cannot be produced by deleting text.** While a next page exists, absorb pulls the lines straight back (length oscillates instead of shrinking). To build a nearly-full page, use `fillSinglePage(page, { lastLine, freeLines })`: overfill once, read the pager's own cut of page 1 as the capacity, then reuse it as the whole document.
- Place the caret only after reflow settles (`clippedDiaryBoxes` empty), then assert `getSelection().index` before pressing a key — otherwise a late spill turns a boundary Backspace into a plain character delete, and only under parallel load.

## Tests that must stay meaningful

- Open-repair: overflowing single-page blob → more pages, no clip.
- Healthy two-page open: not wholesale re-cut (read static `.ql-editor` text if no Quill on page 2).
- Enter at start/end of last right line → no clip.
- Left page-0 slack absorbs marker from page 2.
- Paste large / header toggle / continuous-right save-load `pages[]` shape.
- Print-parity suite alongside diary-pagination.

## Explicit non-goals (unless user overrides)

- Storing parallel `rightStream` in IndexedDB.
- Re-cutting on every open.
- Changing FIR header / left product rules to rich text.
- Second Quill Selection mirror for measurement.
- Prefs A/B for fit or continuous-right (feature is default-on).
