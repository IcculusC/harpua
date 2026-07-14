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

const defaultPin = (m: BaseMessage): boolean => isHumanMessage(m);

/** The fold: a beforeModel node hook that durably compacts `messages` with
 *  RemoveMessage + hysteresis, cutting at HumanMessage boundaries — plus, for
 *  summarize folds only, a last-resort AIMessage boundary when a single turn
 *  outgrew the trigger on its own (walkie 016). */
@LangGraphMiddleware()
export class CompactionMiddleware implements LangGraphMiddlewareContract {
  static readonly [COMPACTION_STATE] = true;

  private readonly logger = new Logger(CompactionMiddleware.name);

  constructor(
    @Inject(COMPACTION_OPTS) private readonly opts: CompactionOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> {
    const signal = buildCompactionSignal(ctx);
    if (!resolveTrigger(this.opts.triggerAt)(signal)) return;

    const pin = this.opts.pin ?? defaultPin;
    const plan = computeFold(signal.messages, {
      keepRecent: this.opts.keepRecent,
      pin,
      // Mega-turn AI-boundary cuts fold the running turn's own ask — only a
      // summarize fold may do that (the summary stands in for the span).
      aiFallback: this.opts.strategy !== "drop",
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
      const summary = await summarizeSpan(model, this.opts.strategy.schema, prior, plan.foldedSpan);
      return { messages: removals, summary };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (plan.boundary === "ai") {
        // The folded span contains the running turn's own ask; dropping it
        // without a summary would erase the model's current instruction with
        // no record. Decline the fold — the trigger re-fires next cycle.
        this.logger.warn(
          `compaction: summarize failed on a mid-turn (AI-boundary) fold, declining the fold: ${reason}`,
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
