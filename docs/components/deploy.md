# Deploy and local preview

The editor is static files under `editor/`. GitHub Actions publishes that folder to Cloudflare Pages (see [CI / CD](ci-cd.md)).

## Publish flow

```mermaid
flowchart LR
  push[Push_v_tag]
  wf[pages.yml_workflow]
  artifact[Wrangler_pages_deploy_editor]
  pages[Cloudflare_Pages]
  live[bpdiary.arverma.dev]

  push --> wf
  wf --> artifact
  artifact --> pages
  pages --> live
```

Workflow: `.github/workflows/pages.yml` (triggers on a `v*` tag push or manual run; staging deploys come from `deploy-staging.yml`).

## Local preview

```bash
make serve
# open http://127.0.0.1:8080/   (PORT=3000 to override)
```

Equivalent: `python3 scripts/serve.py 8080` (a static server sized for the app's parallel module loads). See the Makefile for `install`, `test`, and `test-e2e`.

No Node build or Python backend for the app itself.

## OAuth origins (Drive)

Add authorized JavaScript origins for production (`https://bpdiary.arverma.dev`) and any local preview URL you use with Drive login. Client ID: `editor/js/drive-config.js`.

See: [Drive backup](drive-backup.md).
