# @harpua/langgraph

## 0.1.1

### Patch Changes

- 4e6d572: Add the `harpua-skills` CLI. Run it (or set `"prepare": "harpua-skills"`) in a consuming project to link the agent skills shipped by installed `@harpua/*` packages into `.claude/skills` and `.agents/skills`, so Claude Code and Codex discover them automatically. Relative symlinks on POSIX, directory junctions on Windows; idempotent; never clobbers user-owned directories.
