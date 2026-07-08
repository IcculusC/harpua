import { Inject, Injectable } from "@nestjs/common";
import type { Type } from "@nestjs/common";
import { z } from "zod";
import {
  GRAPH_METADATA,
  TOOL_METHODS_METADATA,
  getGraphFacadeToken,
} from "./constants";
import type {
  ApprovalMessageFn,
  DeclineMessageFn,
  LangGraphOptions,
  ToolMethodMetadata,
} from "./interfaces";

/**
 * Marks a class as a LangGraph graph definition. The class is expected to expose
 * an `edges` member (typically `defineEdges<State>([...])`). Also makes the class
 * injectable so the {@link GraphRegistry} can resolve it via the DI container.
 */
export function LangGraph(options: LangGraphOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(GRAPH_METADATA, options, target);
    // Apply @Injectable so forFeature can register the class as a provider.
    Injectable()(target as unknown as Type<unknown>);
  };
}

/** Reads the {@link LangGraphOptions} off a decorated graph class, if any. */
export function getGraphMetadata(
  target: unknown,
): LangGraphOptions | undefined {
  if (typeof target !== "function") return undefined;
  return Reflect.getMetadata(GRAPH_METADATA, target) as
    | LangGraphOptions
    | undefined;
}

export function isGraphClass(target: unknown): target is Type<any> {
  return getGraphMetadata(target) !== undefined;
}

/** The name/description/schema every `@LangGraphTool` carries. */
export interface LangGraphToolBaseOptions {
  name?: string;
  description: string;
  schema: unknown;
}

/**
 * The approval half of {@link LangGraphToolOptions}, expressed as a discriminated
 * union so `approvalMessage`/`declineMessage` are a COMPILE error unless
 * `requiresApproval: true` is set — the same rule the registration-time zod check
 * enforces at runtime (for JS callers). See {@link ApprovalMessageFn} /
 * {@link DeclineMessageFn} for the throw-safe semantics of each.
 */
export type LangGraphToolApprovalOptions =
  | {
      /**
       * Pauses the tool for human approval BEFORE it executes: the graph
       * `interrupt()`s with a `tool_approval_request` payload and only runs the
       * real method after a resume with `{ approved: true }`. The model-facing
       * schema is unchanged — the model still sees and calls the tool normally;
       * the gate lives in EXECUTION. See {@link requireApproval} for the raw sibling.
       */
      requiresApproval: true;
      /** Custom approval-prompt builder; its result becomes the payload `message`. */
      approvalMessage?: ApprovalMessageFn;
      /** Custom decline-message builder; overrides the default decline text. */
      declineMessage?: DeclineMessageFn;
    }
  | {
      requiresApproval?: false;
      /** Illegal without `requiresApproval: true` (enforced at compile & registration). */
      approvalMessage?: never;
      /** Illegal without `requiresApproval: true` (enforced at compile & registration). */
      declineMessage?: never;
    };

export type LangGraphToolOptions = LangGraphToolBaseOptions &
  LangGraphToolApprovalOptions;

/**
 * Registration-time guard mirroring the compile-time discriminated union: a
 * message builder is only legal with `requiresApproval: true`. Catches JS callers
 * (and any `as` cast) that TypeScript can't — a clear, loud error, never a
 * silently-ignored option. `schema` stays `unknown` (it is itself a zod schema).
 */
const messageFnSchema = z.custom<(...args: any[]) => string>(
  (v) => typeof v === "function",
  { message: "must be a function" },
);
const langGraphToolOptionsSchema = z
  .object({
    name: z.string().optional(),
    description: z.string(),
    schema: z.unknown(),
    requiresApproval: z.boolean().optional(),
    approvalMessage: messageFnSchema.optional(),
    declineMessage: messageFnSchema.optional(),
  })
  .superRefine((opts, ctx) => {
    if (opts.requiresApproval === true) return;
    for (const key of ["approvalMessage", "declineMessage"] as const) {
      if (opts[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is only legal with requiresApproval: true`,
        });
      }
    }
  });

/**
 * Marks a method on an `@Injectable` provider as a LangGraph tool. The method is
 * later bound to its DI instance and wrapped via `tool()` into the graph's
 * ToolNode. Metadata is stored per class and only scanned for the explicitly
 * listed tool provider classes — never app-wide.
 */
export function LangGraphTool(
  options: LangGraphToolOptions,
): MethodDecorator {
  // Validate at registration time (the factory runs while the class is defined),
  // so an illegal option is a clear, loud bootstrap error — never silently dropped.
  const parsed = langGraphToolOptionsSchema.safeParse(options);
  if (!parsed.success) {
    const label = options.name ?? "<unnamed tool>";
    throw new Error(
      `@LangGraphTool('${label}'): ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}.`,
    );
  }
  return (target, propertyKey) => {
    const requiresApproval = options.requiresApproval === true;
    const ctor = target.constructor;
    const existing: ToolMethodMetadata[] =
      (Reflect.getMetadata(TOOL_METHODS_METADATA, ctor) as
        | ToolMethodMetadata[]
        | undefined) ?? [];
    existing.push({
      methodName: propertyKey,
      name: options.name,
      description: options.description,
      schema: options.schema,
      requiresApproval,
      // Only carried when gated; the union/zod guard above keeps them absent otherwise.
      ...(requiresApproval && options.approvalMessage
        ? { approvalMessage: options.approvalMessage }
        : {}),
      ...(requiresApproval && options.declineMessage
        ? { declineMessage: options.declineMessage }
        : {}),
    });
    Reflect.defineMetadata(TOOL_METHODS_METADATA, existing, ctor);
  };
}

/** Reads the tool method descriptors declared on a provider class. */
export function getToolMethods(target: Type<any>): ToolMethodMetadata[] {
  return (
    (Reflect.getMetadata(TOOL_METHODS_METADATA, target) as
      | ToolMethodMetadata[]
      | undefined) ?? []
  );
}

/**
 * Injects the {@link LangGraphRunnable} facade for a `@LangGraph`-decorated
 * graph definition class registered via `LangGraphModule.forFeature`.
 */
export function InjectLangGraphRunnable(
  graphDef: Type<any>,
): ParameterDecorator {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `@InjectLangGraphRunnable: ${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  return Inject(getGraphFacadeToken(meta));
}
