import { type Provider } from "@nestjs/common";
import type { z } from "zod";
import type { AIMessage } from "@langchain/core/messages";
import { LangGraphMiddleware } from "./middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "./middleware.interface";
import type { MiddlewareContext, ModelRequest, ModelNext } from "./middleware.types";
import { CompactionMiddleware } from "./compaction.middleware";
import { ContextWindowMiddleware } from "./context-window.middleware";
import { COMPACTION_OPTS, CompactionOptions, summaryEpilogueOf } from "./compaction.options";
import { CONTEXT_WINDOW_OPTS, ContextWindowOptions } from "./context-window.options";
import { ManagedContextOptions } from "./managed-context.options";
import { COMPACTION_STATE } from "./compaction-state";
import { SUMMARY_EPILOGUE } from "./summary-epilogue.token";

/** Batteries-included context management: one entry that delegates fold + view. */
@LangGraphMiddleware()
export class ManagedContextMiddleware implements LangGraphMiddlewareContract {
  static readonly [COMPACTION_STATE] = true;

  constructor(
    private readonly compaction: CompactionMiddleware,
    private readonly window: ContextWindowMiddleware,
  ) {}

  beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> | Partial<any> | void {
    return this.compaction.beforeModel(ctx);
  }
  wrapModelCall(req: ModelRequest<any>, next: ModelNext): Promise<AIMessage> {
    return this.window.wrapModelCall(req, next);
  }
}

/** Providers for the batteries-included ManagedContext middleware.
 *  Takes the INPUT type (defaulted fields optional) since `.parse()` below
 *  fills defaults — callers pass partial literals. */
export function provideManagedContext(opts: z.input<typeof ManagedContextOptions>): Provider[] {
  const parsed = ManagedContextOptions.parse(opts);
  const compactionOpts = CompactionOptions.parse(parsed);
  const windowOpts = ContextWindowOptions.parse(parsed);
  return [
    { provide: COMPACTION_OPTS, useValue: compactionOpts },
    { provide: CONTEXT_WINDOW_OPTS, useValue: windowOpts },
    { provide: SUMMARY_EPILOGUE, useValue: summaryEpilogueOf(compactionOpts) },
    CompactionMiddleware,
    ContextWindowMiddleware,
    ManagedContextMiddleware,
  ];
}
