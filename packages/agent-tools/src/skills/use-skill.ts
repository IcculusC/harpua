import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { skillToolOptionsSchema, listSkills, type SkillToolOptions } from "./options";

const DESCRIPTION =
  "Load a skill — a procedure you should follow. Returns the skill's " +
  "instructions and LISTS its reference files (with their size in lines) " +
  "without reading them; load a reference with read_skill_file only when " +
  "the skill tells you to.";

const useSkillInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("The skill's name, exactly as listed in your SKILLS menu."),
});

/**
 * `use_skill` — the skill body arrives as a TOOL RESULT, not an ephemeral
 * prompt injection: a skill is a procedure the agent follows across the tool
 * loop, and an injection hands it a checklist that vanishes before cycle 2.
 * References are listed with line counts only (state the cost, spend
 * nothing) — progressive disclosure the model can budget against. An unknown
 * name returns the menu, not an error.
 */
export function useSkillTool(options: SkillToolOptions): StructuredToolInterface {
  const { registry } = skillToolOptionsSchema.parse(options);

  return tool(
    ({ name }) => {
      const body = registry.body(name);
      if (body === null) return `No skill named "${name}".\n\n${listSkills(registry)}`;

      const refs = registry.references(name);
      if (refs.length === 0) return body;
      const listing = refs.map((r) => `- ${r.path} (${r.lines} lines)`).join("\n");
      return (
        `${body}\n\n---\nReference files for this skill (NOT loaded — read ` +
        `one with read_skill_file only when the instructions above call for ` +
        `it):\n${listing}`
      );
    },
    { name: "use_skill", description: DESCRIPTION, schema: useSkillInputSchema },
  );
}
