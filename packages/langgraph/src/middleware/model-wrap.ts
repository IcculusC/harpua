import type { AIMessage } from "@langchain/core/messages";
import type { LangGraphMiddleware, ModelNext, ModelRequest } from "./middleware.interface";

export function composeModelWrap<S>(
  middlewares: Array<Pick<LangGraphMiddleware<S>, "wrapModelCall">>,
  invokeModel: ModelNext,
): ModelNext {
  const wrappers = middlewares.filter((m) => typeof m.wrapModelCall === "function");
  // Fold right so the first middleware ends up outermost.
  return wrappers.reduceRight<ModelNext>(
    (next, mw) => (req: ModelRequest<any>): Promise<AIMessage> =>
      mw.wrapModelCall!(req as ModelRequest<S>, next),
    invokeModel,
  );
}
