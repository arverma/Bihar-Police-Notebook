import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Agent worktrees are created under `.claude/worktrees/` — inside the repo.
     * Without this, `vitest run editor/` matches their `editor/` too and runs
     * every suite twice: once against this checkout and once against a
     * worktree that may be on entirely different code. Both sets are reported
     * together, so a green run says nothing about which tree passed.
     *
     * Same failure mode the Playwright config guards against on the server
     * port: the tests must only ever see the checkout they were started from.
     */
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
