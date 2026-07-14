import { isAIMessage, isHumanMessage, type BaseMessage } from "@langchain/core/messages";

export interface FoldPlan {
  /** Message ids to delete via RemoveMessage (only messages that have ids). */
  removeIds: string[];
  /** The messages being folded away, in order — input to a summarizer. */
  foldedSpan: BaseMessage[];
  /** Which boundary kind the cut landed on. "ai" only ever comes from the
   *  opt-in mega-turn fallback and means the folded span contains the running
   *  turn's own ask — consumers must not apply such a plan without a summary
   *  standing in for the span (see `aiFallback`). */
  boundary: "human" | "ai";
}

/**
 * Plan a durable fold: retain the pinned head and the recent tail, remove the
 * span between them. The cut is advanced FORWARD to the next HumanMessage so a
 * retained history never begins with an orphaned ToolMessage (OpenAI-compatible
 * providers reject that). Returns null when no safe fold exists.
 */
export function computeFold(
  messages: BaseMessage[],
  opts: {
    keepRecent: number;
    pin: (m: BaseMessage) => boolean;
    /** Last-resort mega-turn cut: when BOTH human scans fail (a single turn
     *  that outgrew the trigger on its own has no human boundary anywhere in
     *  the foldable region), cut at the newest AIMessage at/before the naive
     *  cut. Wire-safe for linear tool-loop histories (the agent preset's
     *  shape), where ToolMessages immediately follow their tool_calls parent:
     *  a retained span opening on an AI never strands one, and the pinned
     *  head still opens the history. Two shapes fall outside that guarantee:
     *  histories interleaving several tool_calls AIMessages before their
     *  ToolMessages (parallel model nodes writing one messages channel), and
     *  a custom `pin` matching a tool_calls AIMessage — both can retain a
     *  ToolMessage whose parent folded (the same hazard the human cuts have
     *  in those shapes; `pin` should match a HumanMessage). Opt-in because
     *  this is the only cut that severs the RUNNING turn's own ask and work:
     *  callers must have a summary standing in for the folded span
     *  (summarize-strategy folds pass true; drop folds must not — the model
     *  would lose its current instruction mid-task with no record). */
    aiFallback?: boolean;
  },
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
  let boundary: FoldPlan["boundary"] = "human";
  if (cut < 0 && opts.aiFallback) {
    // Mega-turn (walkie 016): humans exist only at the head and the running
    // turn's own message — one turn outgrew the trigger by itself, both human
    // scans fail, and without this the trigger fires every cycle while the
    // fold nulls every cycle. Cut at the newest AI at/before the naive cut
    // (scanning from naiveCut itself: when the naive cut lands on a
    // ToolMessage this retreats to the tool group's parent, keeping at most
    // a group more than keepRecent — always safe).
    for (let i = Math.min(naiveCut, n - 1); i > headIndex + 1; i--) {
      if (isAIMessage(messages[i]!)) { cut = i; boundary = "ai"; break; }
    }
  }
  if (cut < 0 || cut <= headIndex + 1) return null; // nothing to fold safely

  const foldedSpan = messages.slice(headIndex + 1, cut);
  const removeIds = foldedSpan
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (removeIds.length === 0) return null;

  return { removeIds, foldedSpan, boundary };
}
