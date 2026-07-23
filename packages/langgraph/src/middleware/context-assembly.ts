import { SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { markCacheBoundary } from "./cache-markers";
import type { CompactionSummary } from "./compaction-state";

/** Deterministic template so the same summary renders byte-identically.
 *  `epilogue` is applied HERE, at render time — never stored in the summary
 *  object — so repeated folds cannot accumulate it. */
export function renderSummary(
  summary: CompactionSummary,
  epilogue?: string | null,
): SystemMessage {
  const lines = [
    "Summary of earlier conversation:",
    `Goal: ${summary.goal}`,
    `Key decisions: ${summary.keyDecisions.join("; ")}`,
    `Open questions: ${summary.openQuestions.join("; ")}`,
    `Artifacts: ${summary.artifacts.join("; ")}`,
    `Current state: ${summary.currentState}`,
  ];
  if (epilogue) lines.push(epilogue);
  return new SystemMessage(lines.join("\n"));
}

/**
 * Assemble the render layout: [pinned head, summary?, ...tail], stamping boundaries.
 *
 * Copy-on-write for the head: this is a `wrapModelCall` view over persisted
 * graph-state messages, so the pinned head is never mutated in place. When
 * `cacheHints` is set, a shallow clone (same class/prototype, fresh
 * `additional_kwargs`) is marked and returned instead of the original —
 * keeping the checkpointed message pristine across turns/providers.
 */
export function assembleWindow(
  messages: BaseMessage[],
  summary: CompactionSummary | null,
  opts: {
    pin: (m: BaseMessage) => boolean;
    cacheHints: boolean;
    summaryEpilogue?: string | null;
  },
): BaseMessage[] {
  if (!summary) return messages;
  const headIndex = messages.findIndex(opts.pin);
  if (headIndex < 0) return messages;

  const original = messages[headIndex]!;
  const rendered = renderSummary(summary, opts.summaryEpilogue); // fresh — safe to mark directly
  let head = original;
  if (opts.cacheHints) {
    // clone the persisted head so marking never mutates checkpoint state
    head = Object.assign(
      Object.create(Object.getPrototypeOf(original)),
      original,
      { additional_kwargs: { ...original.additional_kwargs } },
    );
    markCacheBoundary(head);
    markCacheBoundary(rendered);
  }
  return [
    ...messages.slice(0, headIndex),
    head,
    rendered,
    ...messages.slice(headIndex + 1),
  ];
}

/** Replace ToolMessage content older than `evictBeyond` positions with a stub. */
export function evictOldToolOutputs(messages: BaseMessage[], evictBeyond: number): BaseMessage[] {
  const cutoff = messages.length - evictBeyond;
  return messages.map((m, i) => {
    if (i < cutoff && m instanceof ToolMessage) {
      return new ToolMessage({ id: m.id, content: "[tool output elided]", tool_call_id: m.tool_call_id });
    }
    return m;
  });
}
