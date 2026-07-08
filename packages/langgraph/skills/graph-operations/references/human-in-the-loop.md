# Human-in-the-loop: pausing for a human decision

Framework-generic. There are two patterns, in order of preference:

1. **Approval-gated tools** — the primary pattern. When the human decision is
   "should this tool run?", flag the tool and the framework pauses it for you.
2. **A manual interrupt node** — the general case, for any pause that isn't a
   tool call (free-text prompts, choices, multi-step wizards).

Both build on the same primitive: one `interrupt()` call plus one `resume()`.

## 1. Approval-gated tools (primary)

A destructive or sensitive tool should not run until a human approves it. Flag
it and the framework wraps its execution in an approval gate — no approval node,
no routing, no side-channel:

```ts
// Provider tool:
@LangGraphTool({
  name: "cancel_order",
  description: "Cancel an order by its id. Requires the user's approval.",
  schema: z.object({ orderId: z.string() }),
  requiresApproval: true,
})
cancelOrder(input: { orderId: string }): string {
  return this.orders.cancel(input.orderId);
}

// Raw LangChain tool instance — the sibling marker:
import { requireApproval } from "@harpua/langgraph";
@LangGraph({ name: "agent", state, tools: [requireApproval(dangerousTool())] })
```

### What the flag does

Enforcement lives in `buildGraphTools` (the single source of truth for both the
ToolNode executor and the model-bound schemas), so:

- **The model sees the tool normally.** Its name/description/schema are
  byte-for-byte identical to an unflagged tool — the model still emits the tool
  call. The gate is on EXECUTION, not on what the model is told.
- **Before the real tool runs**, the graph `interrupt()`s with a tagged payload:

  ```ts
  { type: "tool_approval_request", tool: "cancel_order", args: { orderId: "7" } }
  ```

- **On resume with `{ approved: true }`** the real tool runs and returns its
  result. **On `{ approved: false, reason? }`** it does NOT run and returns a
  ToolMessage string — `The user declined cancel_order: <reason|no reason given>.`
  — so the model can respond gracefully. The resume value is zod-validated; an
  unknown shape is a clear error and never counts as an approval.

This is why it's the primary pattern: a real model can call a tool but can never
set a side-channel field, so gating on the tool call is the only mechanism that
works with a live LLM. (Gating via a model-set `additional_kwargs` flag is a
mock-only fiction — real models hallucinate rather than emit it.)

### Custom approval / decline wording (optional)

Two optional builders tailor the human-facing text. Both are **only legal with
`requiresApproval: true`** — supplying either without the flag is a loud
registration-time error (enforced at compile via the option types and at runtime
via zod), never a silently-ignored option:

```ts
@LangGraphTool({
  name: "cancel_order",
  description: "Cancel an order by its id. Requires the user's approval.",
  schema: z.object({ orderId: z.string() }),
  requiresApproval: true,
  // Adds `message` to the interrupt payload. Zod-parse the args — never assume.
  approvalMessage: (args) => {
    const { orderId } = z.object({ orderId: z.string() }).parse(args);
    return `Permanently cancel order ${orderId}? This cannot be undone.`;
  },
  // Overrides the default "The user declined <tool>: <reason|no reason given>."
  declineMessage: (args, reason) =>
    `Kept the order intact${reason ? `: ${reason}` : ""}.`,
})
```

- `approvalMessage(args)` runs when the tool pauses; its return is added to the
  interrupt payload as `message: string` (absent when no builder is set, so an
  unadorned tool's payload is unchanged). `ToolApprovalRequest` gains `message?`.
- `declineMessage(args, reason?)` runs on a declined resume and replaces the
  default decline text.
- **Throw-safe:** a builder that throws never corrupts the flow — `approvalMessage`
  falls back to omitting `message`, `declineMessage` falls back to the default
  text, and the framework emits a Nest `Logger` warning.

The raw-tool sibling takes the same two options as a second argument:
`requireApproval(tool, { approvalMessage, declineMessage })`.

### Surfacing it

The payload flows through the same generic interrupt surfacing as any other (see
§4–6 below): the turn response carries `interrupt`, the SSE terminal event
carries it, and the CLI switches on `type` to render an approval prompt. Resume
with `chat.resume(threadId, { approved })`.

### Observability

A flagged tool keeps its `langgraph.tool <name>` span. The gate is the OUTERMOST
wrapper, so the span covers only real execution — the pause's `GraphInterrupt`
throws before the span opens, and the span is never marked errored by the wait.
An approved call emits the span on the resume pass; a declined call emits none
(nothing executed).

## 2. A manual interrupt node (general case)

When the pause is not a tool call — a free-text question, a choice, a
multi-step wizard — put `interrupt()` in a dedicated node reached by a `route`,
so the pause point is explicit in the graph's structure.

### Design the interrupt payload

`interrupt(value)` hands `value` to the client verbatim. Make it a
**discriminated object**, not a bare string — the client switches on a `type`
tag to decide how to render and prompt:

```ts
const decision = interrupt({
  type: "approval_request",
  message: `Approve cancellation of order ${orderId}?`,
}) as boolean | { approved?: boolean };
```

A tagged payload lets one thread raise several *different* interrupt kinds and a
client dispatch on `type` (approval vs. free-text prompt vs. choice) instead of
guessing from shape.

### Where interrupt() lives

Put it in a **dedicated node** reached by a `route`, not inline in a busy node:

```ts
function routeAfterModel(state) {
  const last = state.messages.at(-1);
  if (needsHuman(last)) return AskHumanNode;
  return END;
}
// edge: { from: CallModel, to: route(routeAfterModel, [AskHumanNode, END]) }
```

## 3. Resume semantics

`resume(threadId, value)` re-enters the paused node/tool, which **re-runs from
the top**; the `interrupt()` call now RETURNS `value` instead of pausing. Keep
any pre-interrupt work idempotent.

`thread_id` is **mandatory** — resume needs the exact thread the interrupt was
created on. Invoke without one and the facade generates an ephemeral id whose
checkpoint is unreachable: it can never be resumed. Always pass an explicit
`thread_id` for human-in-the-loop.

## 4. Surfacing over HTTP

Return the interrupt payload in the turn response; expose a **separate** resume
endpoint:

```ts
@Post(":threadId") send(...)          // -> { messages, interrupt? }
@Post(":threadId/resume")
resume(@Param("threadId") threadId, @Body() b: { approved: boolean }) {
  return this.chat.resume(threadId, b.approved);
}
```

Detect a pause with `result.__interrupt__` (or `turn.interrupt`); the client
POSTs its decision to `/resume`.

## 5. Surfacing over SSE

The stream's **terminal event** carries the payload. Detect the terminator with
`getStreamedInterrupts`, stash the value, emit it on the final event:

```ts
for await (const chunk of await graph.streamUpdates(input, cfg)) {
  const interrupts = getStreamedInterrupts(chunk);
  if (interrupts) { interrupt = interrupts[0].value; continue; }
  // ...normal per-node update
}
yield { kind: "final", messages, ...(interrupt !== undefined ? { interrupt } : {}) };
```

This works for an approval-gated tool exactly as for a manual node — the
interrupt raised inside the ToolNode surfaces through the same `__interrupt__`
terminator.

## 6. A CLI y/n prompt

Flip a flag when a turn pauses; read one line as the decision, then `resume`:

```ts
if (awaitingApproval) {
  const approved = /^y(es)?$/i.test(line);
  const turn = await chat.resume(threadId, approved);
  awaitingApproval = turn.interrupt !== undefined; // maybe another gate
} else {
  const turn = await chat.send(threadId, line);
  awaitingApproval = turn.interrupt !== undefined;
}
```

Render the prompt from the payload's `type`: a `tool_approval_request` reads as
"run `<tool>` with `<args>`?", a free-text `interrupt` however that kind needs.

## Multi-step approvals

Because resume re-runs to the *next* pause, one thread can gate several actions
in sequence: after each `resume`, if the returned turn still carries an
`interrupt`, prompt again. The `thread_id` stays constant across the whole chain.
