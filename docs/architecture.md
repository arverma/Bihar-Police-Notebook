# Architecture

Bihar Police Notebook is a **static website** (the editor). There is no application server that stores your notes. Documents live in the browser (IndexedDB). Optional backup copies them into **your** Google Drive when you choose to sync.

**Live editor:** [https://bpdiary.arverma.dev/](https://bpdiary.arverma.dev/) (`bpdiary` is the domain alias for Bihar Police Notebook.)

## High-level system

```mermaid
flowchart LR
  User([User])
  Editor[Editor_site]
  IDB[(IndexedDB)]
  GIT[Google_Input_Tools]
  Drive[Google_Drive]
  Print[Native_print_or_raster_PDF]

  User --> Editor
  Editor --> IDB
  Editor --> GIT
  Editor --> Drive
  Editor --> Print
```

| Piece | Role |
|-------|------|
| [Editor site](components/editor-shell.md) | UI: header, History, Letter/Diary pages, overlays |
| [IndexedDB](components/storage.md) | Local autosave on this device |
| [Google Input Tools](components/typing.md) | Hinglish → Hindi suggestions (network; desktop/tablet) |
| [Google Drive](components/drive-backup.md) | Manual backup / restore into your Drive folder |
| [Print / PDF](components/templates.md) | Shared A4 print document → native print (desktop) or raster PDF (iOS/iPadOS) |

## Editor internals (modules)

```mermaid
flowchart TB
  main[main.js]
  sheets[Letter_Diary_sheets]
  exportPipe[export_router]
  scale[page-scale.js]
  store[document-store.js]
  drive[drive-auth_drive-sync]
  translit[translit.js]
  dict[dictation.js_ui]

  main --> sheets
  main --> exportPipe
  main --> scale
  main --> store
  main --> drive
  main --> translit
  main --> dict
  sheets --> store
```

| Module area | Files | Detail page |
|-------------|-------|-------------|
| Shell / History / save | `editor/js/main.js` | [Editor shell](components/editor-shell.md) |
| Letter / Diary | `letter-sheet.js`, `diary-sheet.js`, `quill-pages.js` | [Templates](components/templates.md) |
| Document export | `export/router.js`, `export/print-document.js`, `export/raster-pdf.js` | [Templates](components/templates.md) |
| Screen scale | `page-scale.js` | [Page preview](components/page-preview.md) |
| Local DB | `document-store.js` | [Storage](components/storage.md) |
| Drive | `drive-config.js`, `drive-auth.js`, `drive-sync.js` | [Drive backup](components/drive-backup.md) |
| Typing | `translit.js`, `word-boundaries.js` | [Typing](components/typing.md) |
| Voice | `dictation.js`, `dictation-ui.js` | [Dictation](components/dictation.md) |
| Prefs | `prefs.js` | Used by Drive + dictation |
| Styles | `editor/css/editor.css` (+ responsive/layout modules) | [Editor shell](components/editor-shell.md) |
| Hosting | `.github/workflows/pages.yml` | [Deploy](components/deploy.md) |

## Module naming convention

- **Lowercase kebab-case** filenames; name by domain responsibility, not implementation mechanics.
- Prefer suffixes that match the job: `-sheet`, `-store`, `-pages`, `-document`, `-pdf`, or a clear verb noun (`router.js`).
- Group a multi-file subsystem in a folder when the layers are distinct — export lives under `editor/js/export/` (`print-document` → `router` → `raster-pdf`).
- Keep conventional entry/clear names (`main.js`, `drive-*`, `dictation.js`) even when shorter alternatives exist.
- Colocate Vitest as `name.test.js` next to `name.js`; Playwright specs under `tests/` use behavior names, not `-test` suffixes.

## Phone vs computer

Behavior changes at **768px** width. See [Desktop vs mobile](desktop-vs-mobile.md).

## Testing

| Layer | Location | Command |
|-------|----------|---------|
| Unit (Vitest) | `editor/js/**/*.test.js` | `npm test` |
| E2E (Playwright) | `tests/*.spec.js` | `npm run test:e2e` |

See [tests/README.md](../tests/README.md).

## Important constants

| Item | Value |
|------|--------|
| Live origin | `https://bpdiary.arverma.dev` |
| Drive folder | `Bihar Police Notebook Backup — do not delete` |
| Drive scope | `drive.file` (files the app creates) |
| IndexedDB (docs) | `bp-writing-tool` |
| IndexedDB (auth) | `bp-writing-tool-auth` |
| Mobile breakpoint | `max-width: 768px` |
| Autosave debounce | 600ms |
