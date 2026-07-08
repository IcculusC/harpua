---
"@harpua/langgraph": patch
---

Add approval-gated tools: `@LangGraphTool({ requiresApproval: true })` and the raw-tool sibling `requireApproval(tool)` pause a tool with a `tool_approval_request` interrupt before it executes, running the real tool only on a resume with `{ approved: true }` (a decline returns a graceful ToolMessage the model can respond to). Enforcement lives in `buildGraphTools`, so it covers both the ToolNode executor and the model-bound schemas while keeping the model-facing tool identical to an unflagged one. The resume value is zod-validated. Exports `requireApproval` and the `ToolApprovalRequest` type. This replaces the mock-only `additional_kwargs` side-channel pattern, which a real LLM can never set.
