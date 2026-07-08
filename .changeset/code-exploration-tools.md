---
"@harpua/agent-tools": patch
---

Add `codeExplorationTools` — a family of read-only, sandboxed, context-safe code
tools (`search_code` via ripgrep, `read_lines`, `file_stats`). Every path is
confined to a configured root (rejecting `..` traversal and symlink escapes) and
every result is bounded with explicit truncation markers. Individual factories
(`searchCodeTool`, `readLinesTool`, `fileStatsTool`) are exported alongside the
bundle.
