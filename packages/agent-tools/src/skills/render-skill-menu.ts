import type { Skill } from "./skill-registry";

/**
 * The system-prompt TOC: name + description per skill, nothing else — the
 * agent loads a body with `use_skill` when one applies. Renders `""` for an
 * empty registry (callers pass through untouched, keeping the prompt
 * byte-stable). Relies on the registry's name sort for stable output bytes —
 * stable bytes are what keep the provider's prompt-prefix cache warm.
 */
export function renderSkillMenu(skills: readonly Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return (
    "SKILLS — procedures you can load. When one applies, load it with " +
    `use_skill BEFORE you start.\n${lines.join("\n")}`
  );
}
