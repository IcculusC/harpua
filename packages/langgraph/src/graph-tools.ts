import { Logger } from "@nestjs/common";
import type { InjectionToken, Provider, Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { ToolMessage, type AIMessageChunk } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

import { getGraphMetadata, getToolMethods } from "./decorators";
import type { ApprovalMessageFn, DeclineMessageFn } from "./interfaces";
import { instrumentRawTool, instrumentTool } from "./observability";
import { getAgentMetadata } from "./agent/agent.decorator";
import { lowerAgent } from "./agent/agent-compiler";
import { composeToolWrap } from "./middleware/tool-wrap";

/** Logs a warning when a user-supplied approval/decline message builder throws. */
const approvalLogger = new Logger("LangGraphApprovalGate");

/**
 * Structural, fork-safe test for a raw LangChain tool INSTANCE. A `tool(...)`
 * result is an object exposing `lc_namespace`, a `name`, and an `invoke`
 * method; a provider CLASS is a constructor `function` and fails this parse.
 * Kept structural (not `instanceof`) so a tool built against a pnpm-forked
 * copy of `@langchain/core` is still recognised.
 */
const rawToolSchema = z.object({
  lc_namespace: z.array(z.string()),
  name: z.string().min(1),
  invoke: z.custom<(...args: any[]) => unknown>((v) => typeof v === "function"),
});

/* ------------------------------------------------------------------ *
 * Approval-gated tools
 *
 * A tool flagged for approval pauses via LangGraph's `interrupt()` BEFORE it
 * runs, handing the client a structured `tool_approval_request` payload; the
 * real tool only executes after a resume with `{ approved: true }`. Enforcement
 * lives here in {@link buildGraphTools} — the single source of truth — so it
 * covers the ToolNode execution path automatically, while the model-facing
 * schema (name/description/schema) stays byte-for-byte identical to an unflagged
 * tool: the model sees and calls the tool normally; only its EXECUTION is gated.
 *
 * Proven empirically against @langchain/langgraph@1.4.7 that `interrupt()` works
 * inside a tool ToolNode executes (see __tests__/tool-interrupt-proof.spec.ts):
 * it reads the run context via the async-local-storage config the ToolNode sets.
 * ------------------------------------------------------------------ */

/**
 * Fork-safe marker for a raw tool that must be approved before it runs. Uses a
 * GLOBAL `Symbol.for` key so the mark is recognised even across a pnpm-forked
 * duplicate of this package (a plain `Symbol()` would differ per module copy),
 * mirroring the structural, non-`instanceof` handling {@link rawToolSchema} uses.
 */
const REQUIRES_APPROVAL = Symbol.for("@harpua/langgraph:requiresApproval");

/**
 * Custom wording for an approval-gated tool — the raw-tool sibling of the
 * `@LangGraphTool({ approvalMessage, declineMessage })` options. Both are optional
 * and share the same throw-safe semantics (see {@link ApprovalMessageFn} /
 * {@link DeclineMessageFn}).
 */
export interface RequireApprovalOptions {
  approvalMessage?: ApprovalMessageFn;
  declineMessage?: DeclineMessageFn;
}

const messageFnSchema = z.custom<(...args: any[]) => string>(
  (v) => typeof v === "function",
);
const requireApprovalOptionsSchema = z.object({
  approvalMessage: messageFnSchema.optional(),
  declineMessage: messageFnSchema.optional(),
});

/**
 * Marks a raw LangChain tool INSTANCE as requiring human approval before it
 * executes — the raw-tool sibling of `@LangGraphTool({ requiresApproval: true })`.
 * Returns the same instance (with a non-enumerable marker) so it stays a normal
 * `StructuredToolInterface` the model binds unchanged; the gate is applied when
 * {@link buildGraphTools} mounts it. Optional {@link RequireApprovalOptions}
 * (approval/decline wording) ride ON the same fork-safe marker — so a pnpm-forked
 * duplicate of this package still reads them — never on the tool's own surface.
 *
 * @example
 * ```ts
 * @LangGraph({ name: "agent", state, tools: [requireApproval(dangerousTool(), {
 *   approvalMessage: (args) => `Really wipe ${(args as { target: string }).target}?`,
 * })] })
 * ```
 */
export function requireApproval<T extends StructuredToolInterface>(
  rawTool: T,
  options: RequireApprovalOptions = {},
): T {
  const parsed = requireApprovalOptionsSchema.parse(options);
  Object.defineProperty(rawTool, REQUIRES_APPROVAL, {
    value: parsed,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return rawTool;
}

function isApprovalRequired(rawTool: unknown): boolean {
  return (
    typeof rawTool === "object" &&
    rawTool !== null &&
    (rawTool as Record<symbol, unknown>)[REQUIRES_APPROVAL] !== undefined
  );
}

/** Reads the {@link RequireApprovalOptions} carried on a marked raw tool, if any. */
function approvalOptionsOf(rawTool: unknown): RequireApprovalOptions {
  const marker = (rawTool as Record<symbol, unknown>)[REQUIRES_APPROVAL];
  const parsed = requireApprovalOptionsSchema.safeParse(marker);
  return parsed.success ? parsed.data : {};
}

/**
 * The payload an approval-gated tool hands the client when it pauses. A tagged
 * discriminated object (like every harpua interrupt payload) so a client can
 * switch on `type`. Exported as {@link ToolApprovalRequest} for clients.
 */
const toolApprovalRequestSchema = z.object({
  type: z.literal("tool_approval_request"),
  /** The gated tool's name (as the model called it). */
  tool: z.string(),
  /** The arguments of the paused tool call. */
  args: z.unknown(),
  /**
   * Human-facing approval prompt, present only when the tool declares an
   * `approvalMessage` builder (and it did not throw). Absent otherwise, so the
   * payload of a tool without custom wording is byte-identical to before.
   */
  message: z.string().optional(),
});

export type ToolApprovalRequest = z.infer<typeof toolApprovalRequestSchema>;

/** The resume value the client sends back to approve or decline. */
const toolApprovalResumeSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
});

/** A ToolCall as `ToolNode` hands it to a raw tool's `invoke`. */
const toolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  id: z.string().optional(),
});

/** The call args to surface: a ToolCall's `.args`, else the input verbatim. */
function callArgsOf(input: unknown): unknown {
  const parsed = toolCallSchema.safeParse(input);
  return parsed.success ? (parsed.data.args ?? {}) : input;
}

/** Zod-validate the resume value; an unknown shape is a clear, actionable error. */
function resolveDecision(
  toolName: string,
  decision: unknown,
): z.infer<typeof toolApprovalResumeSchema> {
  const parsed = toolApprovalResumeSchema.safeParse(decision);
  if (!parsed.success) {
    throw new Error(
      `Invalid resume value for approval-gated tool '${toolName}': expected ` +
        `{ approved: boolean, reason?: string }, received ${JSON.stringify(
          decision,
        )}.`,
    );
  }
  return parsed.data;
}

/** The framework default when a tool declares no custom `declineMessage`. */
function defaultDeclineMessage(toolName: string, reason?: string): string {
  return `The user declined ${toolName}: ${reason ?? "no reason given"}.`;
}

/**
 * Runs the tool's `approvalMessage` builder for the interrupt payload. A THROWING
 * builder must never corrupt the flow: catch it, warn via the Nest logger, and
 * fall back to no message (so the payload matches an unadorned approval request).
 */
function buildApprovalMessage(
  fn: ApprovalMessageFn | undefined,
  toolName: string,
  args: unknown,
): string | undefined {
  if (!fn) return undefined;
  try {
    return fn(args);
  } catch (err) {
    approvalLogger.warn(
      `approvalMessage for tool '${toolName}' threw; omitting message. ${String(
        err,
      )}`,
    );
    return undefined;
  }
}

/**
 * Runs the tool's `declineMessage` builder for a declined call. Same throw-safety
 * as {@link buildApprovalMessage}, but the fallback is the framework default text
 * rather than nothing — a declined tool always returns SOME message to the model.
 */
function buildDeclineMessage(
  fn: DeclineMessageFn | undefined,
  toolName: string,
  args: unknown,
  reason: string | undefined,
): string {
  if (!fn) return defaultDeclineMessage(toolName, reason);
  try {
    return fn(args, reason);
  } catch (err) {
    approvalLogger.warn(
      `declineMessage for tool '${toolName}' threw; using default decline text. ${String(
        err,
      )}`,
    );
    return defaultDeclineMessage(toolName, reason);
  }
}

type ToolFn = (...args: any[]) => unknown | Promise<unknown>;

/**
 * Wraps a provider tool's execution behind a human approval gate. Applied as the
 * OUTERMOST wrapper (outside {@link instrumentTool}), so the `langgraph.tool`
 * span covers only real execution — never the human wait — and the pause's
 * `GraphInterrupt` throw is never recorded as a span error. A declined call
 * returns a plain string; `tool(...)` turns it into the ToolMessage the model reads.
 */
function approvalGatedProviderTool(
  toolName: string,
  run: ToolFn,
  options: RequireApprovalOptions = {},
): ToolFn {
  return (...args: any[]) => {
    const callArgs = args[0];
    const message = buildApprovalMessage(
      options.approvalMessage,
      toolName,
      callArgs,
    );
    const decision = interrupt(
      toolApprovalRequestSchema.parse({
        type: "tool_approval_request",
        tool: toolName,
        args: callArgs,
        ...(message !== undefined ? { message } : {}),
      }),
    );
    const { approved, reason } = resolveDecision(toolName, decision);
    return approved
      ? run(...args)
      : buildDeclineMessage(options.declineMessage, toolName, callArgs, reason);
  };
}

/**
 * The raw-tool sibling of {@link approvalGatedProviderTool}. Proxies `invoke`
 * (which `ToolNode` calls) to pause first; on approval it delegates to the
 * already-instrumented tool (so the span opens only for real execution), on
 * decline it returns a `ToolMessage` carrying the decline text (the raw tool's
 * `invoke` returns a ToolMessage, so we match that shape and thread the
 * `tool_call_id` through for ToolNode to map).
 */
function approvalGatedRawTool(
  instrumented: StructuredToolInterface,
  toolName: string,
  options: RequireApprovalOptions = {},
): StructuredToolInterface {
  const gatedInvoke = (input: unknown, ...rest: any[]): unknown => {
    const callArgs = callArgsOf(input);
    const message = buildApprovalMessage(
      options.approvalMessage,
      toolName,
      callArgs,
    );
    const decision = interrupt(
      toolApprovalRequestSchema.parse({
        type: "tool_approval_request",
        tool: toolName,
        args: callArgs,
        ...(message !== undefined ? { message } : {}),
      }),
    );
    const { approved, reason } = resolveDecision(toolName, decision);
    if (approved) {
      return (instrumented.invoke as (...a: any[]) => unknown)(input, ...rest);
    }
    const call = toolCallSchema.safeParse(input);
    return new ToolMessage({
      content: buildDeclineMessage(
        options.declineMessage,
        toolName,
        callArgs,
        reason,
      ),
      tool_call_id: call.success ? (call.data.id ?? "") : "",
      name: toolName,
    });
  };
  return new Proxy(instrumented, {
    get(target, prop): unknown {
      if (prop === "invoke") return gatedInvoke;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * The runnable a graph-bound model exposes: `bindTools` on any `BaseChatModel`
 * returns exactly this — a `Runnable` over the model's message input/output —
 * and an un-bound `BaseChatModel` is assignable to it too. Annotate the token a
 * node injects with this type (both `provideGraphBoundModel` arms produce it).
 */
export type GraphBoundModel = Runnable<
  BaseLanguageModelInput,
  AIMessageChunk,
  BaseChatModelCallOptions
>;

/**
 * Builds the SAME LangChain tool array a graph's `ToolNode` mounts: every
 * `@LangGraphTool` method on each DI-resolved provider class listed in
 * `@LangGraph({ tools })`, plus each raw `StructuredToolInterface` instance,
 * all wrapped with the same `langgraph.tool <name>` tracing. This is the single
 * source of truth shared by the `ToolNode` builder (which executes tool calls)
 * and `provideGraphBoundModel`/`provideGraphTools` (which expose the schemas to
 * a chat model so it can emit tool calls).
 *
 * A graph with no `tools` yields an empty array (so a bound model is returned
 * unchanged). A graph that lists providers exposing no `@LangGraphTool` methods,
 * or an entry that is neither a provider class nor a raw tool, fails fast — the
 * same errors the `ToolNode` path has always raised.
 */
export function buildGraphTools(
  graphDef: Type<any>,
  moduleRef: ModuleRef,
): StructuredToolInterface[] {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  const graphName = meta.name;
  const toolEntries = meta.tools ?? [];
  const tools: StructuredToolInterface[] = [];

  for (const entry of toolEntries) {
    // Raw LangChain tool instance: mount as-is, wrapped for tracing — and
    // behind the approval gate if marked with requireApproval().
    if (rawToolSchema.safeParse(entry).success) {
      const raw = entry as StructuredToolInterface;
      const instrumented = instrumentRawTool(raw);
      tools.push(
        isApprovalRequired(raw)
          ? approvalGatedRawTool(instrumented, raw.name, approvalOptionsOf(raw))
          : instrumented,
      );
      continue;
    }
    // Provider class: resolve from DI and wrap each @LangGraphTool method.
    if (typeof entry === "function") {
      const cls = entry as Type<any>;
      let instance: any;
      try {
        instance = moduleRef.get(cls, { strict: false });
      } catch {
        throw new Error(
          `Tool provider ${cls.name} is listed by graph '${graphName}' but not provided in any module.`,
        );
      }
      const methods = getToolMethods(cls);
      for (const m of methods) {
        const toolName = m.name ?? String(m.methodName);
        const fn = (instance[m.methodName] as (...a: any[]) => any).bind(
          instance,
        );
        // Instrument first (inner), then gate (outer) when flagged — the tool's
        // name/description/schema below are unchanged either way, so the model
        // binds the flagged tool exactly as it binds an unflagged one.
        const execute = instrumentTool(toolName, fn);
        const gated = m.requiresApproval
          ? approvalGatedProviderTool(toolName, execute, {
              approvalMessage: m.approvalMessage,
              declineMessage: m.declineMessage,
            })
          : execute;
        tools.push(
          tool(gated, {
            name: toolName,
            description: m.description,
            schema: m.schema as any,
          }),
        );
      }
      continue;
    }
    throw new Error(
      `Graph '${graphName}': tools entry ${String(
        entry,
      )} is neither a tool provider class nor a raw LangChain tool instance.`,
    );
  }

  if (toolEntries.length > 0 && tools.length === 0) {
    throw new Error(
      `Graph '${graphName}' lists tool providers but none expose @LangGraphTool methods.`,
    );
  }

  // `@LangGraphAgent` tools additionally run through each `wrapToolCall`
  // middleware (v1 best-effort: no per-tool state snapshot yet, so `stateOf`
  // always yields `{}` — Retry-style middleware doesn't read tool state).
  // This wraps BOTH the bound-model copy and the ToolNode copy (the same
  // array feeds both); harmless, since `bindTools` only reads name/schema
  // through the Proxy and never calls `invoke`.
  const agentOptions = getAgentMetadata(graphDef);
  if (agentOptions) {
    const lowered = lowerAgent(graphDef);
    const wrapToolMiddleware = lowered.wrapToolMiddleware;
    if (wrapToolMiddleware.length > 0) {
      // `moduleRef` here is the registry's ROOT-scoped ref, so a direct class
      // lookup is flat and cross-contaminates sibling graphs (report 015).
      // The agent's feature module registered its own ModuleRef under a
      // per-agent token (see agentProviders) — resolve THAT (unique token,
      // collision-free), then resolve middleware within the owning scope.
      let ownerRef: ModuleRef = moduleRef;
      try {
        // During DI-time instantiation (provideGraphBoundModel's factory also
        // calls buildGraphTools) a flat get returns the wrapper's instance
        // WITHOUT forcing instantiation — the factory may not have run yet
        // and this can be undefined. That copy's tools never execute (only
        // name/schema are read), so falling back to the root ref is safe;
        // the executing ToolNode is built at bootstrap when all providers
        // exist and the owner ref resolves.
        ownerRef =
          moduleRef.get<ModuleRef>(lowered.ownerRefToken, { strict: false }) ??
          moduleRef;
      } catch {
        /* pre-ownerRef metadata / direct callers: keep the root ref */
      }
      const resolvedWrapToolMiddleware = wrapToolMiddleware.map((c) => {
        try {
          return ownerRef.get(c);
        } catch {
          return moduleRef.get(c, { strict: false });
        }
      });
      const stateOf = (_config: unknown): Readonly<Record<string, never>> => ({});
      return tools.map((t) =>
        composeToolWrap(t, resolvedWrapToolMiddleware, stateOf),
      );
    }
  }

  return tools;
}

/**
 * Injection token under which {@link provideGraphTools} publishes a graph's raw
 * tool array. Derived from the graph's `@LangGraph({ name })` so it matches the
 * facade token's naming — inject it with `@Inject(getGraphToolsToken(MyGraph))`.
 */
export function getGraphToolsToken(graphDef: Type<any>): string {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `getGraphToolsToken: ${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  return `GraphTools:${meta.name}`;
}

export interface ProvideGraphToolsOptions {
  /** The `@LangGraph`-decorated graph definition class. */
  graph: Type<any>;
  /** Token to publish under; defaults to {@link getGraphToolsToken}(graph). */
  provide?: InjectionToken;
}

/**
 * Custom provider exposing a graph's tool array (a `StructuredToolInterface[]`)
 * for apps that want to bind it to a model themselves. The lower-level primitive
 * {@link provideGraphBoundModel} composes. The factory injects `ModuleRef` and
 * builds the array eagerly during instantiation — the tool provider classes it
 * resolves via `ModuleRef.get(strict:false)` are DI singletons, resolvable then.
 */
export function provideGraphTools(options: ProvideGraphToolsOptions): Provider {
  const { graph, provide } = options;
  return {
    provide: provide ?? getGraphToolsToken(graph),
    useFactory: (moduleRef: ModuleRef): StructuredToolInterface[] =>
      buildGraphTools(graph, moduleRef),
    inject: [ModuleRef],
  };
}

export interface ProvideGraphBoundModelOptions {
  /** Token the app chooses for the bound model; nodes inject this. */
  provide: InjectionToken;
  /** The `@LangGraph`-decorated graph whose tools the model should carry. */
  graph: Type<any>;
  /**
   * Any token resolving to a `BaseChatModel` — a class, symbol, or string. This
   * package stays model-agnostic: it never references a concrete model package.
   */
  model: InjectionToken;
}

/**
 * Custom provider that binds a graph's tools to a chat model so a real model can
 * actually emit the tool calls the graph's `ToolNode` executes. The factory
 * resolves the `model` token and the graph's tool array, then returns
 * `model.bindTools(tools)` when the graph has tools (a {@link GraphBoundModel}
 * runnable) or the model unchanged when it has none. Package-agnostic: `model`
 * is any DI token the app owns.
 *
 * Timing: the factory runs during DI instantiation (earlier than the registry's
 * `onApplicationBootstrap` compile), but only reads the graph metadata and
 * resolves already-registered singletons via `ModuleRef` — it never touches the
 * compiled graph, so it cannot race compilation.
 *
 * `model` is resolved via `ModuleRef.get(model, { strict: false })` — a
 * flat, whole-container lookup — rather than a strict factory `inject`, so
 * this provider works wherever it is registered relative to `model`'s own
 * provider (e.g. auto-registered by `LangGraphModule.forFeature` for a
 * `@LangGraphAgent`, a different module than wherever the app provides its
 * chat model). This mirrors every other node/tool resolution in this
 * package (`CallModelNode`, `HookNode`, `GraphRegistry.resolveNode`,
 * `buildGraphTools`'s own provider-class lookup) — graph wiring is
 * intentionally module-boundary-agnostic.
 */
export function provideGraphBoundModel(
  options: ProvideGraphBoundModelOptions,
): Provider {
  const { provide, graph, model } = options;
  return {
    provide,
    useFactory: (moduleRef: ModuleRef): GraphBoundModel => {
      const chatModel = moduleRef.get<BaseChatModel>(model, { strict: false });
      if (chatModel == null) {
        // Without this, the guard below dereferences null and the crash names
        // neither the token nor this provider.
        throw new Error(
          `provideGraphBoundModel: model token ${String(model)} resolved to ` +
            "null — check the token's provider registration (is its factory " +
            "returning null in this scope?).",
        );
      }
      const tools = buildGraphTools(graph, moduleRef);
      if (tools.length > 0 && typeof chatModel.bindTools === "function") {
        return chatModel.bindTools(tools);
      }
      return chatModel;
    },
    inject: [ModuleRef],
  };
}
