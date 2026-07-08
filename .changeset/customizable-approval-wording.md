---
"@harpua/langgraph": patch
---

Add optional `approvalMessage` and `declineMessage` builders to approval-gated tools (`@LangGraphTool` and `requireApproval`). `approvalMessage(args)` surfaces custom wording in the interrupt payload (`ToolApprovalRequest` gains `message?: string`); `declineMessage(args, reason?)` overrides the default decline text. Both are only legal with `requiresApproval: true` (enforced at compile and registration), and are throw-safe — a throwing builder falls back and logs a warning rather than corrupting the run. Purely additive; tools without custom wording are unchanged.
