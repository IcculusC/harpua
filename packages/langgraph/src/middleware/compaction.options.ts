import type { InjectionToken } from "@nestjs/common";
import type { BaseMessage } from "@langchain/core/messages";
import { z, type ZodType } from "zod";
import { CompactionSummarySchema } from "./compaction-state";
import type { CompactionSignal } from "./compaction-signal";

export const COMPACTION_OPTS = Symbol.for("@harpua/langgraph:COMPACTION_OPTS");

/** When to fold: token high-water, message high-water, or a custom predicate. */
export type TriggerSpec =
  | { tokens: number }
  | { messages: number }
  | ((s: CompactionSignal) => boolean);

const TriggerSchema = z.union([
  z.object({ tokens: z.number().int().positive() }).strict(),
  z.object({ messages: z.number().int().positive() }).strict(),
  z.custom<(s: CompactionSignal) => boolean>((v) => typeof v === "function"),
]);

const StrategySchema = z.union([
  z.literal("drop"),
  z
    .object({
      kind: z.literal("summarize"),
      model: z.custom<InjectionToken>((v) => v != null),
      schema: z.custom<ZodType>((v) => v instanceof z.ZodType).default(CompactionSummarySchema),
    })
    .strict(),
]);
export type CompactionStrategy = z.infer<typeof StrategySchema>;

export const CompactionOptions = z.object({
  triggerAt: TriggerSchema,
  keepRecent: z.number().int().positive(),
  pin: z.custom<(m: BaseMessage) => boolean>((v) => typeof v === "function").optional(),
  strategy: StrategySchema.default("drop"),
});
export type CompactionOptions = z.infer<typeof CompactionOptions>;

export { CompactionSummarySchema };
