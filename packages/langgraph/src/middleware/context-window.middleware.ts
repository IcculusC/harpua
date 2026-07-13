import { Inject, type Provider } from "@nestjs/common";
import type { z } from "zod";
import { isHumanMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import { LangGraphMiddleware } from "./middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "./middleware.interface";
import type { ModelRequest, ModelNext } from "./middleware.types";
import { CONTEXT_WINDOW_OPTS, ContextWindowOptions } from "./context-window.options";
import { COMPACTION_STATE, type CompactionSummary } from "./compaction-state";
import { assembleWindow, evictOldToolOutputs } from "./context-assembly";
import { translateCacheMarkers } from "./cache-markers";

const defaultPin = (m: BaseMessage): boolean => isHumanMessage(m);

/** The view: assembles the cache-coherent render layout for each model call. */
@LangGraphMiddleware()
export class ContextWindowMiddleware implements LangGraphMiddlewareContract {
  static readonly [COMPACTION_STATE] = true;

  constructor(@Inject(CONTEXT_WINDOW_OPTS) private readonly opts: ContextWindowOptions) {}

  async wrapModelCall(req: ModelRequest<any>, next: ModelNext): Promise<AIMessage> {
    const pin = this.opts.pin ?? defaultPin;
    const summary = ((req.state as any)?.summary ?? null) as CompactionSummary | null;

    let messages: BaseMessage[] = assembleWindow(req.messages, summary, {
      pin,
      cacheHints: this.opts.cacheHints,
    });
    if (this.opts.evictToolOutputs && this.opts.evictBeyond !== undefined) {
      messages = evictOldToolOutputs(messages, this.opts.evictBeyond);
    }
    if (this.opts.cacheHints) {
      const llmType = (req.model as any)?._llmType?.() ?? "unknown";
      messages = translateCacheMarkers(messages, llmType);
    }
    // Forward a COPY, never write back: an outer middleware that re-invokes
    // next(req) (ProviderGuardrail's retry, RetryMiddleware's error path)
    // must not find this middleware's assembled view on the shared request —
    // a write-back made the second pass re-assemble over its own output
    // (duplicate summary per re-ask).
    return next({ ...req, messages });
  }
}

/** Providers for a ContextWindow view middleware.
 *  Takes the INPUT type (`cacheHints`/`evictToolOutputs` default) since
 *  `.parse()` below fills defaults — callers pass partial literals. */
export function provideContextWindow(opts: z.input<typeof ContextWindowOptions>): Provider[] {
  const parsed = ContextWindowOptions.parse(opts);
  return [{ provide: CONTEXT_WINDOW_OPTS, useValue: parsed }, ContextWindowMiddleware];
}
