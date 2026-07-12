---
"@harpua/langgraph": patch
---

Token-based compaction triggers no longer go silently dead when a provider reports usage only via `response_metadata` (#61). `buildCompactionSignal` now falls back through `response_metadata.tokenUsage.prompt_tokens`/`promptTokens` and `response_metadata.usage.input_tokens`/`prompt_tokens` when `usage_metadata` is absent, and the agent preset's reply normalization is lossless — `response_metadata`, `additional_kwargs`, `invalid_tool_calls`, and `name` now survive to the checkpointed message for chunk and foreign-copy replies.
