---
name: turbo
description: Use when authoring or changing turbo.json tasks, debugging turborepo cache behavior or stale results, or wiring task dependencies in the harpua monorepo.
---

# Turborepo tasks and cache

Everyday commands (root runs, `--filter`, `--force`, single specs) live in CLAUDE.md.
This is the conditional depth: authoring tasks and debugging the cache.

## Authoring tasks in `turbo.json`

Tasks are defined once at the repo root under `tasks`. Key fields:

- **`dependsOn`** — what must finish first. `"^build"` means "build every *upstream*
  workspace dependency before this task." Use it when a task consumes another
  package's build output. Real case: `apps/api`'s tests import `@harpua/langgraph`
  from its compiled `dist`, so `test` declares `"dependsOn": ["^build"]` — otherwise
  the api suite runs against a stale or missing `dist`. A bare name like `"build"`
  (no `^`) depends on that task *within the same package*.
- **`outputs`** — glob array of what the task produces (`["dist/**"]`). Turbo caches
  these and restores them on a cache hit, so a downstream `^build` sees real files
  without re-running. A task with no meaningful output (e.g. `lint`) needs no
  `outputs`. `test` here declares none — it's gated on `^build` but caches only its
  pass/fail, not artifacts.
- **`cache: false` + `persistent: true`** — for long-running processes like `dev`.
  Persistent tasks never terminate and are never cached; nothing may `dependsOn` them.

**Adding a new package requires zero `turbo.json` edits** — tasks resolve through
workspace globs, so a new `packages/*` inherits the root task graph automatically.

## Cache debugging

Turbo hashes each task's `inputs` (source files) and config into a cache key. A
`FULL TURBO` / cache-hit line means it replayed a prior result — which is exactly what
masks staleness when env or config changed outside the hashed inputs.

- `pnpm turbo run <task> --dry-run` — print the resolved task graph and cache keys
  without executing.
- `pnpm turbo run <task> --summarize` — write a run summary (inputs, hashes, hits)
  to inspect *why* a task hit or missed.
- `--force` is the hammer: bypass the cache and observe a genuine run. Use it when a
  result looks stale or when validating for a report.
