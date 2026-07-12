---
"@harpua/langgraph": minor
---

New `ProviderGuardrailMiddleware` (`provideProviderGuardrail({ on?, retries?, note? })`): neutralizes provider-side blocks before they poison history. A guardrail hit (`finish_reason: "content_filter"` by default) arrives as a normal-looking assistant message carrying the provider's canned refusal — checkpointed as-is, the next turn reads it back as the assistant's own words, concludes it refused, and redoes tool work that already succeeded. The middleware swaps the boilerplate for a note aimed at the model's next turn (marker `[[provider-guardrail:<reason>]]` for client rendering), keeps the evidence (`response_metadata`, zero-token usage, id) on the message, and can re-ask up to `retries` times first (worth 1 on stochastic multi-upstream routers).
