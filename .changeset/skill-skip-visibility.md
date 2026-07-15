---
"@harpua/agent-tools": patch
---

`SkillRegistry` skip visibility (field report #17): a consumer's skill silently
tripped the 16KB `SKILL.md` body cap and cost an hour of misdiagnosis because
the only trace was a generic `onWarn` string — skips were a log, not data.
`rescan()` now also returns `skippedSkills: { name, reason }[]` (one entry per
skip, `reason` the same detail sent to `onWarn` minus the `skills: ` prefix),
so a caller can actually act on a skip instead of grepping console output.
Frontmatter failures — a bad `name` vs. an empty `description` — previously
folded into one generic "no valid frontmatter" reason; the structured
`reason` (never the `onWarn` text, which stays byte-identical for existing
parsers) now folds in the first zod issue so the two are distinguishable.
Separately, a directory with no `SKILL.md` at all (a misnamed `skill.md`?)
now gets a single `onWarn` line instead of skipping silently — it still
isn't counted in `skipped`/`skippedSkills`, since it was never a skill
candidate. `renderSkillMenu` also grows an optional `opts.header` so a
caller can swap the leading TOC line; omitting it reproduces the exact
current bytes, keeping the prompt cache warm for everyone who doesn't need it.
