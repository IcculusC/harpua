---
name: verify
description: Use when confirming harpua changes work before committing or reporting done. Runs the canonical root build/lint/test protocol, and for apps/api changes boots the server and CLI and drives the affected chat flows end-to-end.
---

# Verify harpua

Run this before claiming a change works. Verify from the **repo root**, never per-package — turbo builds the dependency graph in order (`@harpua/langgraph` before `@harpua/api`).

## 1. Root protocol (always)

From the repo root:

```bash
pnpm turbo build lint test --force
```

`--force` bypasses the turbo cache so you observe a real run, not a replayed pass. All of build, lint, and test must be green. If nothing in `apps/api`'s runtime behavior changed (e.g. a library-only or docs change), you're done here.

## 2. Boot + curl the affected flow (when apps/api behavior changed)

Build already ran above. Start the API and exercise the chat endpoints that your change touches.

```bash
node apps/api/dist/main.js &        # listens on :3000 (PORT overridable)
sleep 1
```

Plain turn (canned reply):

```bash
curl -s -XPOST localhost:3000/chat/t1 -H 'content-type: application/json' \
  -d '{"message":"hello there"}'
# -> {"messages":["Hi! I can check an order ..."]}
```

Tool call through DI (order lookup):

```bash
curl -s -XPOST localhost:3000/chat/t1 -H 'content-type: application/json' \
  -d '{"message":"what is the status of order 42?"}'
# -> messages contains "Order 42: ... status shipped ..."
```

Interrupt + resume (approval-gated `cancel_order` tool):

```bash
curl -s -XPOST localhost:3000/chat/t2 -H 'content-type: application/json' \
  -d '{"message":"please cancel order 7"}'
# -> body has "interrupt": { "type":"tool_approval_request","tool":"cancel_order","args":{"orderId":"7"} }
curl -s -XPOST localhost:3000/chat/t2/resume -H 'content-type: application/json' \
  -d '{"approved":true}'
# -> messages contains "Order 7 has been cancelled"
```

Decline path (a different thread, so order stays shipped):

```bash
curl -s -XPOST localhost:3000/chat/t2d -H 'content-type: application/json' \
  -d '{"message":"please cancel order 7"}'          # same tool_approval_request interrupt
curl -s -XPOST localhost:3000/chat/t2d/resume -H 'content-type: application/json' \
  -d '{"approved":false}'
# -> messages mention the tool was declined; the order is NOT cancelled
```

SSE stream (node updates then a final event):

```bash
curl -s -N "localhost:3000/chat/t3/stream?message=what%20is%20the%20status%20of%20order%2042%3F"
# -> event: CallModelNode / event: tools / ... / event: final
```

Stop the server when done: `kill %1` (or `pkill -f 'apps/api/dist/main.js'`).

## 3. Piped CLI check (when apps/api behavior changed)

The CLI shares the same `ChatService`/graph. It builds to `apps/api/dist/cli.js` (built in step 1). Drive it non-interactively:

```bash
printf 'hi\nlook up order 42\nexit\n' | node apps/api/dist/cli.js t1
```

Expect: the greeting for `hi`, then a `[tool: lookup_order]` line and an `[assistant] Here's what I found: Order 42 …` for the lookup, then a clean exit.

Approval-gated cancel through the CLI (the `y` line approves the pause):

```bash
printf 'please cancel order 7\ny\nexit\n' | node apps/api/dist/cli.js t2
```

Expect: a `[tool: cancel_order]` line, an `[approval needed] run cancel_order with {"orderId":"7"}?` line and the `Approve? (y/n)` prompt, then after `y` an `[assistant] …Order 7 has been cancelled…` line, then a clean exit.

## Common Mistakes

- Running `pnpm --filter @harpua/api test` (or any per-package command) and calling it verified. Use the root protocol so cross-package build order and lint are covered.
- Dropping `--force` and trusting a cached "pass" that never re-ran.
- Stopping at green tests when apps/api runtime behavior changed — boot + curl and the piped CLI check catch wiring/bootstrap failures tests can miss.
- Leaving the backgrounded server running — `kill %1` when finished.
- Treating a `new Date()`-driven flake as expected; deterministic code should never need a retry.
