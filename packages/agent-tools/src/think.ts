import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

/**
 * General-purpose "when to think" guidance, modelled on Anthropic's published
 * guidance for the think tool. Consumers may override it per domain via
 * {@link ThinkToolOptions.description}.
 */
const DEFAULT_DESCRIPTION =
  "Use this tool to reason through a problem before acting. It fetches nothing " +
  "and changes nothing — it only records your reasoning so you can work through " +
  "it step by step. Reach for it between tool calls: before an irreversible " +
  "action, when instructions or policies conflict, or when a tool result is " +
  "surprising and you need to decide what to do next. The thought is recorded " +
  "for your own benefit; nothing is executed.";

/**
 * Input schema for the think tool. The model fills `thought`; the handler is a
 * no-op, so the field only ever serves as a place to write reasoning.
 */
const thinkInputSchema = z.object({
  thought: z
    .string()
    .describe(
      "Your reasoning. Nothing runs — this is a private scratchpad for working " +
        "through the problem.",
    ),
});

/** Options accepted by {@link thinkTool}. Extra keys are rejected. */
const thinkToolOptionsSchema = z
  .object({
    /** Overrides the default when-to-think description (some domains tune it). */
    description: z.string().min(1).optional(),
  })
  .strict();

export type ThinkToolOptions = z.input<typeof thinkToolOptionsSchema>;

/**
 * The Anthropic-style `think` tool: a no-op scratchpad an agent calls to record
 * reasoning between tool calls. The handler returns an empty string, so calling
 * it executes nothing and produces no output beyond the recorded thought.
 *
 * @example
 * ```ts
 * import { thinkTool } from "@harpua/agent-tools";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 *
 * const toolNode = new ToolNode([thinkTool()]);
 * ```
 */
export function thinkTool(options?: ThinkToolOptions): StructuredToolInterface {
  const { description } = thinkToolOptionsSchema.parse(options ?? {});
  return tool(() => "", {
    name: "think",
    description: description ?? DEFAULT_DESCRIPTION,
    schema: thinkInputSchema,
  });
}
