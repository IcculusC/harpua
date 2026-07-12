---
"@harpua/agent-tools": minor
---

New runtime skills family: the app's own agent discovers, loads, and follows skills at runtime. `SkillRegistry(dir)` scans `<skill>/SKILL.md` entries (zod-validated frontmatter, symlink/malformed/oversized entries skipped with a warning, `rescan()` for mid-session installs with a menu-bytes `changed` signal), `useSkillTool` returns a skill body as a persistent tool result and lists reference files with line counts without reading them, and `readSkillFileTool` serves capped line-numbered reads out of a per-skill jail (the skill's own directory is the sandbox root). `renderSkillMenu` renders the system-prompt TOC; the live-menu middleware stays a documented recipe so the package keeps its `@langchain/core` + zod dependency surface.
