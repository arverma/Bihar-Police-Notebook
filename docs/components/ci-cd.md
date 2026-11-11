# CI / CD pipeline

All automation lives in `.github/workflows/`. There are three workflow files.

---

## Workflow overview

| Workflow file | Triggers | What it does |
|---|---|---|
| [`test.yml`](../../.github/workflows/test.yml) | PR open/update | Runs the full test suite |
| [`deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) | Push to any non-`main` branch | Tests (skipped when the branch has an open PR, which runs them) → deploys to Cloudflare Pages (staging) |
| [`pages.yml`](../../.github/workflows/pages.yml) | Push of a `v*` tag, manual `workflow_dispatch` | Tests → deploys to Cloudflare Pages (production) |

**No workflow fires on documentation-only changes.** Any push where every changed file matches `docs/**` or `**.md` is skipped automatically via `paths-ignore`.

---

## Test workflow — `test.yml`

Runs on:
- Every PR (any branch → any branch), unless only docs changed
- Called internally by `deploy-staging.yml` and `pages.yml` via `workflow_call`

Jobs (run in parallel, each on its own runner, so wall time is the slowest job rather than the sum):

| Job | What it runs |
|---|---|
| **`unit`** | `npm ci`, the vendored-bundle checks (`vendor:tiptap -- --check`, `vendor:docx -- --check`; they fail if `editor/vendor/` no longer matches the pinned versions), then `npm test` (Vitest). No browser needed. |
| **`e2e`** | Playwright desktop, mobile and tablet-width projects (tablets use the mobile layout), split into 3 shards (`--shard=N/3`). Installs Chromium only. |
| **`webkit`** | `npm run test:webkit` on the editing, pagination and export specs. Installs WebKit only. |
| **`visual`** | `npm run test:visual`; Linux PNG baselines compared natively on the Ubuntu runner. |
| **`test`** (named "Unit + E2E") | Aggregate gate. Passes only when all four above succeed. `pages.yml` and `deploy-staging.yml` depend on it, and it keeps the original check name so branch-protection settings keep matching. |

Each Playwright job uploads its own report artifact (7 days, also on failure). In CI Playwright uses 2 workers per runner and 1 retry.

Concurrency: one run per `workflow + ref`; newer push cancels older.

---

## Staging deploy — `deploy-staging.yml`

Runs on every push to a feature branch (anything that is not `main` or `master`), **skipped** if only `docs/**` or `**.md` files changed.

Also triggerable manually via `workflow_dispatch` for any branch.

Jobs (sequential):

1. **`open-pr`** — checks whether the branch has an open pull request
2. **`test`** — calls `test.yml` via `workflow_call`, only when there is no open PR (the PR's own `test.yml` run covers it otherwise, so the suite does not run twice per push). With a PR open, staging can deploy before the PR's tests finish.
3. **`deploy`** — runs after `test` passes, or right away when `test` was skipped; — `cloudflare/wrangler-action@v3` runs:
   ```
   pages deploy editor --project-name=bpdiary --branch=staging
   ```
   The deploy summary in Actions shows a per-branch Cloudflare preview URL.

Concurrency: one staging deploy per branch; newer push cancels the running deploy for that branch.

---

## Production deploy — `pages.yml`

### Normal release path

```
git tag v1.x
git push origin v1.x
```

Triggers `pages.yml` only (no test-only workflow fires for tags). Jobs:

1. **`test`** — same full suite via `workflow_call`
2. **`deploy`** — checks out the exact tag ref, then runs:
   ```
   pages deploy editor --project-name=bpdiary --branch=main
   ```
   Cloudflare marks this as the production deployment → served at `bpdiary.arverma.dev`.

### Manual rollback

Go to **Actions → "Deploy to Cloudflare Pages (production)" → Run workflow**.

Enter the tag to restore (e.g. `v1.3`) in the `ref` field. The workflow checks out that exact commit, re-runs tests against it, and deploys it to production if green.

Leave `ref` blank to re-deploy `HEAD` without re-tagging (useful if a deploy step failed but the code is fine).

Concurrency: only one production deploy runs at a time; a newer trigger cancels the current one.

---

## Secrets required

Stored in **GitHub → Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Custom token: Account → Cloudflare Pages → Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Found in Cloudflare dashboard right sidebar |

`GITHUB_TOKEN` is automatically provided by GitHub Actions — no manual setup needed.

---

## Paths-ignore rule

The following file patterns are excluded from automatic CI triggers:

```yaml
paths-ignore:
  - 'docs/**'   # any file under the docs/ directory
  - '**.md'     # any Markdown file anywhere in the repo
```

This applies to `test.yml` (PR trigger) and `deploy-staging.yml` (push trigger). It does **not** and cannot apply to `workflow_call` — when staging (without an open PR) or production deploys call `test.yml` internally, the full suite always runs regardless of what files changed.

---

## Tag naming convention

Tags follow [semantic versioning](https://semver.org/): `vMAJOR.MINOR` or `vMAJOR.MINOR.PATCH`.

Examples: `v1.0`, `v1.1`, `v1.4.2`.

Only tags matching the glob `v*` trigger the production deploy workflow.

---

See also: [Architecture](../architecture.md), [deploy.md](deploy.md).
