# Chrome extension

Small MV3 package under `extension/`. It only **opens or focuses** the live editor. It does not read other sites or your documents.

## Flow

```mermaid
flowchart TD
  click[Toolbar_icon_click]
  query[Find_existing_editor_tab]
  focus[Activate_and_focus_window]
  create[Open_new_tab_to_editor_URL]

  click --> query
  query -->|found| focus
  query -->|not_found| create
```

## Details

- **Manifest:** `extension/manifest.json` — name *Bihar Police Notebook*, permission `tabs` only.
- **Worker:** `extension/background.js` — `ORIGIN` = `https://bpdiary.arverma.dev`.
- **Install:** Chrome → Developer mode → Load unpacked → select `extension/`.

For local preview, temporarily point `ORIGIN` / `BASE` at your local server, then reload the extension.

See also: [Deploy](deploy.md), [Architecture](../architecture.md).
