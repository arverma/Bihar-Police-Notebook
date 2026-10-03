# Tests

Two runners, two homes — do not mix styles.

| Layer | Location | Command | Role |
|-------|----------|---------|------|
| Unit | `editor/js/**/*.test.js` (colocated with modules) | `npm test` | Vitest + jsdom: pure module behavior, document operations on the real schema |
| E2E | `tests/*.spec.js` | `npm run test:e2e` | Playwright: live editor in Chromium (desktop, mobile, tablet) |
| E2E, Safari engine | same specs (see the `webkit` project) | `npm run test:webkit` | Editing, pagination and export in WebKit |
| Visual | `tests/visual/` | `npm run test:visual` | Linux pixel baselines |

Unit tests stay next to the code they lock (e.g. `export/router.js` → `export/router.test.js`). Playwright specs stay under `tests/` and assert wiring / visual parity only — keep routing math and filename helpers in Vitest. Spec filenames should describe the behavior under test, not end in a redundant `-test` suffix.

## Driving the editor

- Read editor state through `window.__bpTest` (`editor/js/editor/test-hooks.js`) via the helpers in `tests/pagination-helpers.js`, never through DOM internals — a read must not change what it measures.
- Type with real key presses (`page.keyboard`); wait for pagination with `settle()` before asserting layout.
- IME composition: `tests/ime-composition.spec.js` drives Chrome's input pipeline over CDP (`Input.imeSetComposition`). Still check a real Android keyboard before release (manual checklist).

## Linux / other engines locally

Visual baselines are Linux-only, and WebKit may not be installed on your machine. Both run in the Playwright Docker image matching the installed version:

```bash
npm run test:docker -- --project=webkit
npm run test:visual:update        # regenerate baselines, then review the PNG diffs
```
