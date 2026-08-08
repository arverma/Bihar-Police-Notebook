# Tests

Two runners, two homes — do not mix styles.

| Layer | Location | Command | Role |
|-------|----------|---------|------|
| Unit | `editor/js/**/*.test.js` (colocated with modules) | `npm test` | Vitest + jsdom: pure module behavior |
| E2E | `tests/*.spec.js` | `npm run test:e2e` | Playwright: live editor in Chromium |

Unit tests stay next to the code they lock (e.g. `export/router.js` → `export/router.test.js`). Playwright specs stay under `tests/` and assert wiring / visual parity only — keep routing math and filename helpers in Vitest. Spec filenames should describe the behavior under test, not end in a redundant `-test` suffix.
