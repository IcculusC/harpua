# @harpua/agent-tools

## 0.1.1

### Patch Changes

- ba31859: Add `fileExplorationTools` — a family of read-only, sandboxed, context-safe code
  tools (`search_files` via ripgrep, `read_lines`, `file_stats`). Every path is
  confined to a configured root (rejecting `..` traversal and symlink escapes) and
  every result is bounded with explicit truncation markers. Individual factories
  (`searchFilesTool`, `readLinesTool`, `fileStatsTool`) are exported alongside the
  bundle.
