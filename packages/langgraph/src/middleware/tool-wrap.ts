import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { LangGraphMiddleware, ToolNext, ToolRequest } from "./middleware.interface";

/** A ToolCall as `ToolNode` hands it to a raw tool's `invoke`. */
const toolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  id: z.string().optional(),
  type: z.literal("tool_call").optional(),
});

/**
 * Extract `{ args, id }` from whatever `invoke` was actually called with:
 * LangGraph's `ToolNode` passes a `ToolCall` envelope (`{name, args, id,
 * type}`), a direct caller may pass the raw args object. `id` defaults to
 * `""` in the raw-args case (mirrors `approvalGatedRawTool` in
 * `graph-tools.ts`), matching `ToolRequest.id: string` (non-optional).
 */
function normalizeInvokeInput(input: unknown): { args: unknown; id: string } {
  const parsed = toolCallSchema.safeParse(input);
  if (parsed.success) {
    return { args: parsed.data.args ?? {}, id: parsed.data.id ?? "" };
  }
  return { args: input, id: "" };
}

/**
 * Composes each middleware's `wrapToolCall` into a single onion around a
 * tool's `invoke`, mirroring {@link composeModelWrap} on the tool seam
 * (see `model-wrap.ts`) and the Proxy style of `instrumentRawTool`
 * (`observability.ts`). Middlewares with no `wrapToolCall` are filtered out;
 * if none remain, `tool` is returned UNCHANGED (identity — no Proxy).
 *
 * The innermost `next` reconstructs a `ToolCall` from the (possibly
 * mutated) request and invokes the real tool. A middleware may instead
 * return its own `ToolMessage` without calling `next` at all — the
 * human-in-the-loop / decline shape — which never touches the real tool.
 */
export function composeToolWrap<S>(
  tool: StructuredToolInterface,
  middlewares: Array<Pick<LangGraphMiddleware<S>, "wrapToolCall">>,
  stateOf: (config: unknown) => Readonly<S>,
): StructuredToolInterface {
  const wrappers = middlewares.filter((m) => typeof m.wrapToolCall === "function");
  if (wrappers.length === 0) return tool;

  const boundInvoke = tool.invoke.bind(tool);

  const wrappedInvoke = (input: unknown, config?: unknown): Promise<ToolMessage> => {
    const { args, id } = normalizeInvokeInput(input);
    const request: ToolRequest<S> = { name: tool.name, args, id, state: stateOf(config) };

    const invokeReal: ToolNext = (req: ToolRequest<any>) =>
      boundInvoke(
        { name: req.name, args: req.args, id: req.id, type: "tool_call" } as any,
        config as any,
      ) as Promise<ToolMessage>;

    // Fold right so the first middleware ends up outermost.
    const chain = wrappers.reduceRight<ToolNext>(
      (next, mw) => (req: ToolRequest<any>): Promise<ToolMessage> =>
        mw.wrapToolCall!(req as ToolRequest<S>, next),
      invokeReal,
    );

    return chain(request);
  };

  return new Proxy(tool, {
    get(target, prop): unknown {
      if (prop === "invoke") return wrappedInvoke;
      // Read against the real target so getters and private-field access see the
      // original instance, and bind methods to it for the same reason.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
