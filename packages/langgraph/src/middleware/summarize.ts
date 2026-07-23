import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ZodType } from "zod";
import { CompactionSummarySchema, type CompactionSummary } from "./compaction-state";

const SUMMARIZE_SYSTEM_TEXT =
  "Summarize the earlier conversation into the requested structured object. " +
  "Preserve the enduring goal, key decisions, open questions, and artifacts. " +
  "If a prior summary is provided, fold it into the new one so nothing is lost.";

/** Summarize the folded span (plus any prior summary) into the structured schema. */
export async function summarizeSpan(
  model: BaseChatModel,
  schema: ZodType | undefined,
  priorSummary: CompactionSummary | null,
  foldedSpan: BaseMessage[],
  instructions?: string,
): Promise<CompactionSummary> {
  // One system message, not two: a second would move the cached prefix.
  const system = new SystemMessage(
    instructions ? `${SUMMARIZE_SYSTEM_TEXT}\n${instructions}` : SUMMARIZE_SYSTEM_TEXT,
  );
  const prior = priorSummary
    ? [new SystemMessage(`Prior summary:\n${JSON.stringify(priorSummary)}`)]
    : [];
  const out = await model
    .withStructuredOutput((schema ?? CompactionSummarySchema) as Record<string, any>)
    .invoke([system, ...prior, ...foldedSpan]);
  return out as CompactionSummary;
}
