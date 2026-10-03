# Editor shell

The editor UI is a fixed app chrome around the A4 page preview. Markup lives in `editor/index.html`; layout tokens and shell CSS are in `editor/css/tokens.css`, `layout-shell.css`, `header-responsive.css`.

## Layout blocks

```mermaid
flowchart TB
  body[body.app-shell]
  header[Fixed_header]
  appBody[app-body]
  sidebar[History_sidebar]
  main[main.main-content]
  stage[editor-stage]

  body --> header
  body --> appBody
  appBody --> sidebar
  appBody --> main
  main --> stage
```

| Region | Responsibility |
|--------|----------------|
| Header | History toggle, brand, document name, the format toolbar (centre pill, with the dictation mic at its right end), PDF (Hindi Typing toggle on wider screens). On phones (≤768px) the toolbar wraps to its own row under the bar |
| History sidebar | Letter/Diary switch, a labeled **New diary / New letter** button, Drive backup icon, document list (each row: Word export, Delete) |
| `main-content` | Desktop vertical scrollport; padding for fixed header |
| `editor-stage` | Page preview; on mobile also the scroll / pinch viewport |

Orchestration: `editor/js/main.js` (sidebar toggle, template switch, autosave hooks, chrome height).

## History behavior

- Opens/closes only via the panel button (or Ctrl/Cmd+H / B) — not by outside click.
- On wide screens (≥1025px), opening History nudges the workspace slightly; on smaller screens it is an overlay drawer.
- Documents are grouped by **date created**; older day groups start collapsed. Each row shows last-updated time.
- Each row's **Word** and **Delete** buttons are always visible (muted until hover or focus) so touch and keyboard users can reach them. Word export: [Word export](word-export.md).
- The Drive button keeps the same chrome as its neighbours; the sync state is a corner dot (red = not connected / error, blue = syncing, green = connected) plus the button's title and label.
- Drive backup menu (sidebar): **Sync all** (pull + push), **Sync new** (push pending only), **Disconnect**.

## Scroll ownership

```mermaid
flowchart LR
  subgraph desktop [Desktop]
    mainD[main-content_scrolls]
  end
  subgraph mobile [Mobile_le_768px]
    stageM[editor-stage_scrolls]
  end
```

- **Desktop:** `.editor-stage` stays `overflow: visible` so wheel events reach `.main-content`.
- **Mobile:** `.main-content` is `overflow: hidden`; `#editorStage` scrolls (and handles pinch).

See: [Desktop vs mobile](../desktop-vs-mobile.md), [Page preview](page-preview.md).
