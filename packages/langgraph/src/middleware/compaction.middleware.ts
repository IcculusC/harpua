import { Inject, Logger, type Provider } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { z } from "zod";
import { RemoveMessage, isHumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LangGraphMiddleware } from "./middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "./middleware.interface";
import type { MiddlewareContext } from "./middleware.types";
import { COMPACTION_OPTS, CompactionOptions } from "./compaction.options";
import { COMPACTION_STATE, type CompactionSummary } from "./compaction-state";
import { computeFold } from "./compaction-cut";
import { buildCompactionSignal, resolveTrigger } from "./compaction-signal";
import { summarizeSpan } from "./summarize";
import { ContextWindowMiddleware } from "./context-window.middleware";

const defaultPin = (m: BaseMessage): boolean => isHumanMessage(m);

/** Consecutive per-thread summarize failures on AI-boundary plans before the
 *  middleware stops attempting them for that thread. Each attempt sends the
 *  whole folded span (peak context) to the summarizer, and the decline path
 *  retries next cycle by design — a persistent post-tokens failure (schema
 *  mismatch, provider rejecting the span) would otherwise pay that price
 *  every cycle for the rest of the turn. */
const MAX_AI_FOLD_SUMMARIZE_FAILURES = 3;

/** The fold: a beforeModel node hook that durably compacts `messages` with
 *  RemoveMessage + hysteresis, cutting at HumanMessage boundaries — plus, for
 *  summarize folds only, a last-resort AIMessage boundary when a single turn
 *  outgrew the trigger on its own (walkie 016). */
@LangGraphMiddleware()
export class CompactionMiddleware implements LangGraphMiddlewareContract {
  static readonly [COMPACTION_STATE] = true;

  private readonly logger = new Logger(CompactionMiddleware.name);

  /** Lazily resolved: is a summary renderer registered alongside this
   *  middleware? (null = not checked yet.) */
  private rendererPresent: boolean | null = null;

  /** Consecutive AI-boundary summarize failures, per thread. Entries are
   *  deleted on success; only failing threads ever occupy a slot. */
  private readonly aiFoldFailures = new Map<string, number>();

  constructor(
    @Inject(COMPACTION_OPTS) private readonly opts: CompactionOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The AI-boundary fold's safety story is "the summary stands in for the
   *  folded ask" — but the summary channel is only ever rendered into the
   *  model's view by `ContextWindowMiddleware`. Standalone `provideCompaction`
   *  + summarize writes it to a channel nothing reads, so folding the running
   *  turn's ask there would erase the live instruction invisibly. */
  private hasSummaryRenderer(): boolean {
    if (this.rendererPresent === null) {
      try {
        this.rendererPresent =
          this.moduleRef.get(ContextWindowMiddleware, { strict: false }) != null;
      } catch {
        this.rendererPresent = false;
      }
      if (!this.rendererPresent) {
        this.logger.warn(
          "compaction: summarize strategy without a ContextWindowMiddleware — the summary is written but never rendered, so mega-turn (AI-boundary) folds are disabled. Use provideManagedContext, or register provideContextWindow alongside.",
        );
      }
    }
    return this.rendererPresent;
  }

  private threadKey(ctx: MiddlewareContext<any>): string {
    return String((ctx.config as any)?.configurable?.thread_id ?? "");
  }

  async beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> {
    const signal = buildCompactionSignal(ctx);
    if (!resolveTrigger(this.opts.triggerAt)(signal)) return;

    const pin = this.opts.pin ?? defaultPin;
    const plan = computeFold(signal.messages, {
      keepRecent: this.opts.keepRecent,
      pin,
      // Mega-turn AI-boundary cuts fold the running turn's own ask — only a
      // summarize fold whose summary is actually rendered may do that, and
      // only while the thread hasn't exhausted its summarize-failure budget.
      aiFallback:
        this.opts.strategy !== "drop" &&
        this.hasSummaryRenderer() &&
        (this.aiFoldFailures.get(this.threadKey(ctx)) ?? 0) < MAX_AI_FOLD_SUMMARIZE_FAILURES,
    });
    if (!plan) return;

    const removals = plan.removeIds.map((id) => new RemoveMessage({ id }));
    if (this.opts.strategy === "drop") {
      return { messages: removals };
    }
    // summarize: resolve the model token; on any failure fall back to drop.
    try {
      const model = this.moduleRef.get<BaseChatModel>(this.opts.strategy.model, { strict: false });
      const prior = (ctx.state?.summary ?? null) as CompactionSummary | null;
      const summary = await summarizeSpan(
        model,
        this.opts.strategy.schema,
        prior,
        plan.foldedSpan,
        this.opts.strategy.instructions,
      );
      if (plan.boundary === "ai") this.aiFoldFailures.delete(this.threadKey(ctx));
      return { messages: removals, summary };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (plan.boundary === "ai") {
        // The folded span contains the running turn's own ask; dropping it
        // without a summary would erase the model's current instruction with
        // no record. Decline the fold — the trigger re-fires next cycle,
        // until this thread's failure budget runs out.
        const key = this.threadKey(ctx);
        if (this.aiFoldFailures.size > 1024) this.aiFoldFailures.clear();
        const failures = (this.aiFoldFailures.get(key) ?? 0) + 1;
        this.aiFoldFailures.set(key, failures);
        this.logger.warn(
          failures >= MAX_AI_FOLD_SUMMARIZE_FAILURES
            ? `compaction: summarize failed on a mid-turn (AI-boundary) fold ${failures}x for this thread — giving up on mid-turn folds here: ${reason}`
            : `compaction: summarize failed on a mid-turn (AI-boundary) fold, declining the fold: ${reason}`,
        );
        return;
      }
      this.logger.warn(`compaction: summarize failed, falling back to drop: ${reason}`);
      return { messages: removals };
    }
  }
}

/** Providers for a drop/summarize compaction middleware.
 *  Takes the INPUT type (`strategy` defaults to "drop") since `.parse()`
 *  below fills defaults — callers pass partial literals. */
export function provideCompaction(opts: z.input<typeof CompactionOptions>): Provider[] {
  const parsed = CompactionOptions.parse(opts);
  return [{ provide: COMPACTION_OPTS, useValue: parsed }, CompactionMiddleware];
}
