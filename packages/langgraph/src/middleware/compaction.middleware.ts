import { Inject, type Provider } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { RemoveMessage, isHumanMessage, type BaseMessage } from "@langchain/core/messages";
import { LangGraphMiddleware } from "./middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "./middleware.interface";
import type { MiddlewareContext } from "./middleware.types";
import { COMPACTION_OPTS, CompactionOptions } from "./compaction.options";
import { COMPACTION_STATE } from "./compaction-state";
import { computeFold } from "./compaction-cut";
import { buildCompactionSignal, resolveTrigger } from "./compaction-signal";

const defaultPin = (m: BaseMessage): boolean => isHumanMessage(m);

/** The fold: a beforeModel node hook that durably compacts `messages` with
 *  RemoveMessage + hysteresis, cutting only at HumanMessage boundaries. */
@LangGraphMiddleware()
export class CompactionMiddleware implements LangGraphMiddlewareContract {
  static readonly [COMPACTION_STATE] = true;

  constructor(
    @Inject(COMPACTION_OPTS) private readonly opts: CompactionOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> {
    const signal = buildCompactionSignal(ctx);
    if (!resolveTrigger(this.opts.triggerAt)(signal)) return;

    const pin = this.opts.pin ?? defaultPin;
    const plan = computeFold(signal.messages, { keepRecent: this.opts.keepRecent, pin });
    if (!plan) return;

    const removals = plan.removeIds.map((id) => new RemoveMessage({ id }));
    // Task 6 replaces this with a strategy switch; drop returns removals only.
    return { messages: removals };
  }
}

/** Providers for a drop/summarize compaction middleware. */
export function provideCompaction(opts: CompactionOptions): Provider[] {
  const parsed = CompactionOptions.parse(opts);
  return [{ provide: COMPACTION_OPTS, useValue: parsed }, CompactionMiddleware];
}
