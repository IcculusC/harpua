import { isHumanMessage, type BaseMessage } from "@langchain/core/messages";

export interface FoldPlan {
  /** Message ids to delete via RemoveMessage (only messages that have ids). */
  removeIds: string[];
  /** The messages being folded away, in order — input to a summarizer. */
  foldedSpan: BaseMessage[];
}

/**
 * Plan a durable fold: retain the pinned head and the recent tail, remove the
 * span between them. The cut is advanced FORWARD to the next HumanMessage so a
 * retained history never begins with an orphaned ToolMessage (OpenAI-compatible
 * providers reject that). Returns null when no safe fold exists.
 */
export function computeFold(
  messages: BaseMessage[],
  opts: { keepRecent: number; pin: (m: BaseMessage) => boolean },
): FoldPlan | null {
  const n = messages.length;
  const headIndex = messages.findIndex(opts.pin);
  if (headIndex < 0) return null;

  const naiveCut = Math.max(headIndex + 1, n - opts.keepRecent);
  // Advance to the next HumanMessage at/after the naive cut.
  let cut = -1;
  for (let i = naiveCut; i < n; i++) {
    if (isHumanMessage(messages[i]!)) { cut = i; break; }
  }
  if (cut < 0) {
    // Mid-turn: the protected tail is all ai/tool (a long tool loop), so no
    // boundary exists at/after the naive cut — but one may sit BEHIND it:
    // the running turn's own HumanMessage. Cutting there keeps MORE than
    // keepRecent (always safe) and the retained history still opens on a
    // human. Without this fallback exactly the turns that need relief get
    // none — the trigger fires every cycle and the fold nulls every cycle
    // while context rides at peak.
    for (let i = naiveCut - 1; i > headIndex + 1; i--) {
      if (isHumanMessage(messages[i]!)) { cut = i; break; }
    }
  }
  if (cut < 0 || cut <= headIndex + 1) return null; // nothing to fold safely

  const foldedSpan = messages.slice(headIndex + 1, cut);
  const removeIds = foldedSpan
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (removeIds.length === 0) return null;

  return { removeIds, foldedSpan };
}
