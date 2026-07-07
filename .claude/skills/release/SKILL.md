---
name: release
description: Use when changing a publishable package in the harpua monorepo (@harpua/langgraph, @harpua/langgraph-testing, @harpua/agent-tools) and deciding whether a change needs a changeset, which bump to pick, and how the release train ships it.
---

# Releasing harpua packages

Releases run on [changesets](https://github.com/changesets/changesets). Merging the
automated **Version Packages** PR is the only human action that publishes.

## When to add a changeset

Any change to the source, deps, or public API of a publishable package — `@harpua/langgraph`,
`@harpua/langgraph-testing`, `@harpua/agent-tools` — needs a changeset. Docs-only changes,
repo tooling, CI, and edits to private packages (`@harpua/api`, `@harpua/typescript-config`,
`@harpua/eslint-config`) do **not**.

## How to add one

```bash
pnpm exec changeset
```

Pick the affected package(s), pick the bump, write a one-line summary (it becomes the
changelog entry). This writes one Markdown file under `.changeset/`. Commit it with your change.

## Picking the bump (0.x semantics, until 1.0)

- **minor** — breaking change (0.x has no major bump; breaking goes to minor).
- **patch** — feature or fix.

## How the release train works

1. You merge a PR that includes a changeset.
2. The `release.yml` workflow opens/updates a **Version Packages** PR that bumps versions and
   writes changelogs.
3. Merging that PR runs the full build/lint/test, then publishes to npm via OIDC trusted
   publishing (no tokens) and tags + creates GitHub releases.

## Common mistakes

- Skipping the changeset because "it's small" — every source change to a published package needs one.
- Hand-editing `version` in `package.json` — the Version Packages PR owns versions; never bump by hand.
- Adding a changeset for a private package — they're excluded from versioning; don't.
