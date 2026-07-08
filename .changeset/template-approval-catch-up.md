---
"create-harpua-app": patch
---

Template catches up to `@harpua/langgraph@0.1.3`'s approval-gated tools. Adds an
approval-gated `send_weather_report` tool (records into a new `OutboxService`),
teaches the mock model to route the send/email intent and updates its help text,
adds the `tool_approval_request` render + y/n resume flow to the CLI and a
zod-validated `POST /agent/:threadId/resume` endpoint (400 on a bad body), bumps
the `@harpua/langgraph` floor to `^0.1.3`, and documents the approval flow in the
README. Includes a gated-tool test (approve records the outbox; decline leaves it
empty).
