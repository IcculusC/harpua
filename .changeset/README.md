# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Every change to a publishable package (`@harpua/langgraph`, `@harpua/langgraph-testing`,
`@harpua/agent-tools`) must ship with a changeset.

- Add one with `pnpm exec changeset` and answer the prompts (pick the packages and bump).
- 0.x semantics: **breaking = minor, feature/fix = patch** (until 1.0).
- Private packages (`@harpua/api`, `@harpua/typescript-config`, `@harpua/eslint-config`)
  are excluded from versioning and tagging — never add a changeset for them.
- Docs-only or repo-tooling changes don't need a changeset.

Merging the automated **Version Packages** PR is the only action that publishes.
See `.claude/skills/release/SKILL.md` for details.
