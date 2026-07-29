# Deploy and local preview

The editor is static files under `editor/`. GitHub Actions publishes that folder to GitHub Pages.

## Publish flow

```mermaid
flowchart LR
  push[Push_to_main]
  wf[pages.yml_workflow]
  artifact[Upload_editor_folder]
  pages[GitHub_Pages]
  live[bpdiary.arverma.dev]

  push --> wf
  wf --> artifact
  artifact --> pages
  pages --> live
```

Workflow: `.github/workflows/pages.yml` (triggers on changes under `editor/**`).

## Local preview

```bash
cd editor && python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

No Node build or Python backend for the app itself.

## OAuth origins (Drive)

Add authorized JavaScript origins for production (`https://bpdiary.arverma.dev`) and any local preview URL you use with Drive login. Client ID: `editor/js/drive-config.js`.

See: [Drive backup](drive-backup.md).
