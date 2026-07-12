import { z } from "zod";

import type { SkillRegistry } from "./skill-registry";

/** Structural check (any object honoring the registry surface mounts). */
export const skillRegistrySchema = z.custom<SkillRegistry>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as SkillRegistry).menu === "function" &&
    typeof (v as SkillRegistry).body === "function" &&
    typeof (v as SkillRegistry).references === "function",
  "registry must implement menu, body, and references",
);

/** Options shared by {@link useSkillTool} and {@link readSkillFileTool}. */
export const skillToolOptionsSchema = z
  .object({ registry: skillRegistrySchema })
  .strict();
export type SkillToolOptions = z.input<typeof skillToolOptionsSchema>;

/** The tool-result fallback listing (distinct from the system-prompt menu). */
export function listSkills(registry: SkillRegistry): string {
  const skills = registry.menu();
  if (skills.length === 0) return "You have no skills installed.";
  return `Available skills:\n${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`;
}
