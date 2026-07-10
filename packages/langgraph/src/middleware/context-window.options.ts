import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export const CONTEXT_WINDOW_OPTS = Symbol.for("@harpua/langgraph:CONTEXT_WINDOW_OPTS");

export const ContextWindowOptions = z.object({
  cacheHints: z.boolean().default(true),
  evictToolOutputs: z.boolean().default(false),
  evictBeyond: z.number().int().positive().optional(),
  pin: z.custom<(m: BaseMessage) => boolean>((v) => typeof v === "function").optional(),
});
export type ContextWindowOptions = z.infer<typeof ContextWindowOptions>;
