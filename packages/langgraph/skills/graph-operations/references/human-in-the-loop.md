# Human-in-the-loop: the approval gate

Framework-generic. Pausing a run for a human decision is one `interrupt()` call
plus one `resume()`. This is the pattern end to end.

## 1. Design the interrupt payload

`interrupt(value)` hands `value` to the client verbatim. Make it a
**discriminated object**, not a bare string — the client switches on a `type`
tag to decide how to render and prompt:

```ts
const decision = interrupt({
  type: "approval_request",
  action: pending.action,
  orderId: pending.orderId,
  message: `Approve cancellation of order ${pending.orderId}?`,
}) as boolean | { approved?: boolean };
```

A tagged payload lets one thread raise several *different* interrupt kinds and a
client dispatch on `type` (approval vs. free-text prompt vs. choice) instead of
guessing from shape.

## 2. Where interrupt() lives

Put it in a **dedicated approval node** reached by a `route`, not inline in a
busy node — so the pause point is explicit in the graph's structure:

```ts
function routeAfterModel(state) {
  const last = state.messages.at(-1);
  if (last?.additional_kwargs?.pending_action) return ApprovalNode;
  return END;
}
// edge: { from: CallModel, to: route(routeAfterModel, [ApprovalNode, END]) }
```

## 3. Resume semantics

`resume(threadId, value)` re-enters the paused node, which **re-runs from the
top**; the `interrupt()` call now RETURNS `value` instead of pausing. Keep any
pre-interrupt work idempotent.

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

## Multi-step approvals

Because resume re-runs to the *next* pause, one thread can gate several actions
in sequence: after each `resume`, if the returned turn still carries an
`interrupt`, prompt again. The `thread_id` stays constant across the whole chain.
