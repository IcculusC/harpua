---
name: release
description: Use when changing a publishable package in the harpua monorepo (@harpua/langgraph, @harpua/langgraph-testing, @harpua/models, @harpua/agent-tools, create-harpua-app) and deciding whether a change needs a changeset, which bump to pick, and how the release train ships it.
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

## Picking the bump (semver, from 1.0)

- **major** — breaking change: removed/renamed public API, a peer-range or Node-floor raise, a changed
  default or output format a consumer can observe. Put the migration in the changeset text and, for
  anything bigger than a line, in `MIGRATING-1.0.md`-style notes linked from it.
- **minor** — backwards-compatible feature.
- **patch** — backwards-compatible fix (including docs shipped in the tarball and dependency bumps
  that don't change the public surface).

The 0.x rule (breaking = minor) is gone: 0.x history in the CHANGELOGs used it, 1.0+ does not.

## Pre mode (prereleases)

`.changeset/pre.json` exists only while a prerelease line is open. In pre mode the Version Packages
PR bumps to `X.Y.Z-<tag>.N` and publishes under the `<tag>` dist-tag (e.g. `next`), never `latest`;
`pre.json`'s `changesets` array records which changesets were already consumed. Rules:

- Open a line with `pnpm exec changeset pre enter <tag>` (commit `pre.json`), keep adding changesets
  as usual, and merge Version Packages PRs to cut `-<tag>.N` builds.
- Close it with `pnpm exec changeset pre exit` (commit the `pre.json` change, which flips it to
  `"mode": "exit"`). The **next** Version Packages PR then drops the suffix and publishes the stable
  version to `latest`. Merging the exit commit itself publishes nothing.
- Caret ranges with a prerelease (`^1.0.0-next.1`) also match the stable `1.0.0` and later 1.x, but not
  earlier prereleases (`1.0.0-next.0`); scaffolds and docs can point at the prerelease until stable ships.
- Changeset bumps are relative to the last stable version, so a `major` changeset in pre mode yields
  `1.0.0-next.N`, not `2.0.0-...`.

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
