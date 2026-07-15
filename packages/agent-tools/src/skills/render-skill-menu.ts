import type { Skill } from "./skill-registry";

/** The default header, kept as a named constant so it stays byte-identical
 *  across refactors — stable bytes are what keep the provider's
 *  prompt-prefix cache warm, and a caller's custom header diffs cleanly
 *  against a fixed baseline instead of an inline literal. */
const DEFAULT_HEADER =
  "SKILLS — procedures you can load. When one applies, load it with use_skill BEFORE you start.";

/**
 * The system-prompt TOC: name + description per skill, nothing else — the
 * agent loads a body with `use_skill` when one applies. Renders `""` for an
 * empty registry (callers pass through untouched, keeping the prompt
 * byte-stable) REGARDLESS of `opts.header`. Relies on the registry's name
 * sort for stable output bytes — stable bytes are what keep the provider's
 * prompt-prefix cache warm. `opts.header` swaps the leading line for a
 * caller that wants different wording; omitting it (or passing `{}`)
 * reproduces the original byte-identical output.
 */
export function renderSkillMenu(
  skills: readonly Skill[],
  opts?: { header?: string },
): string {
  if (skills.length === 0) return "";
  const header = opts?.header ?? DEFAULT_HEADER;
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return `${header}\n${lines.join("\n")}`;
}
