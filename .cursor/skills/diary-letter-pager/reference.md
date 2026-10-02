# Diary / letter pager — reference

## Key files

| File | Role |
|------|------|
| `editor/js/editor/schema.js` | Document schema: pages, `flowCell`, `cont` on paragraphs/lists |
| `editor/js/editor/pager/layout.js` | Read-only views: pages, cells, positions |
| `editor/js/editor/pager/measure.js` | Geometry reads: overflow, line cut (`coordsAtPos`), slack |
| `editor/js/editor/pager/ops.js` | Transaction builders: split, spill, absorb, normalize `cont`, collapse, `mapThroughPager` |
| `editor/js/editor/pager/plugin.js` | Scheduling, suspension, history merge, page-number/overflow decorations |
| `editor/js/editor/structure.js` | Selection clamp, cross-cell guard, page-edge Backspace/Delete/arrows, Cmd+A |
| `editor/js/editor/page-views.js` | Page node views: diary header inputs, chrome, box height |
| `editor/js/editor/diary-geometry.js` | A4 geometry, header fields, header prefill |
| `editor/js/editor/doc-sheet.js` | Sheet API used by `main.js` (content, undo, page focus, active field) |
| `editor/js/editor/text-field.js` | Paragraph-offset text view for transliteration / dictation |
| `editor/js/editor/doc-format.js` | Saved format `{format:'bp-doc', v, doc}`, unsupported detection |
| `editor/js/editor/test-hooks.js` | `window.__bpTest` for e2e tests |
| `editor/js/export/print-document.js` | Live-clone print source of truth |
| `tests/diary-pagination.spec.js` | Pager e2e |
| `tests/pagination-helpers.js` | `setDoc`, `setCaret`, `settle`, `columnBlocks`, `clippedBoxes` |
| `docs/components/templates.md` | Human-facing architecture notes |

## Playwright browser cache (agents)

Cursor agent shells often set `PLAYWRIGHT_BROWSERS_PATH` to a throwaway sandbox directory. Use the host cache instead of reinstalling:

- macOS default: `$HOME/Library/Caches/ms-playwright`
- `make test-e2e` exports that path on Darwin
- One-time host install (run by the user, not the agent): `make playwright`

## Persistence contract

```text
{ "format": "bp-doc", "v": 1, "doc": <ProseMirror doc JSON> }
```

- `parseDoc` / `isSupportedContent` gate every open; anything else is an older-format document (History badge + delete dialog).
- Autosave, History, Drive and print all see this one shape. A schema change bumps `v` and migrates in `doc-format.js`.

## Spill / absorb

- **Spill:** the first block crossing the box bottom is cut at the first rendered line that does not fit (binary search over `coordsAtPos`, snapped to a grapheme). The tail gets `cont: true` and moves with everything after it to the same column on the next page. A cut at a block start moves the whole block; a single unit taller than the box stays (flagged `data-overflow`) and what follows it still moves.
- **Absorb:** with at least one free line, the next page's first block in that column moves up. A `cont` block re-joins the block before it (`normalizeContinuations`); a non-`cont` block stays a separate paragraph. Spill then re-cuts at a real line. A pass that lands back on an earlier document stops absorbing that cell.
- Opening a document (trigger `load`) spills only — never absorbs.
- `collapseTrailingPages(keepIndex)` drops empty trailing pages after the caret page; a diary page with its header on is kept.

## Invariants

- The column's paragraphs in reading order (re-joining `cont` pieces) never change under spill/absorb.
- Only a cell's first block may carry `cont`; page 1 never does.
- The caret stays on the same character across any pager transaction.
- A writing box never clips its last line, at any `--page-scale`.

## History

- Pager transactions after a user edit carry `appendedTransaction` → merged into that undo step. After load, undo/redo or font loading: `addToHistory: false`.
- Header typing: attribute steps have no range, so `page-views.js` groups same-field commits within 1s (only while `undoDepth` is unchanged).

## Suspension

The pager waits while `view.composing`, a mouse button is down, or the suggestion box owns the word (`isHeld`). The suggestion box's style observer in `main.js` resumes it.

## E2E harness

- Read state with `window.__bpTest` (never through DOM internals); wait with `__bpTest.settle()`.
- `afterEach` in the pagination spec asserts `stats.capHits === 0`.
- Use `fillSinglePage(page, { freeLines, lastLine })` to build an exactly-full page: overfill once, read the pager's own capacity, reload with that many lines.
