---
"@harpua/langgraph": patch
---

The summarize compaction strategy accepts `instructions` (appended to the summarizer's system text) and `epilogue` (appended to the rendered summary). Both are optional and default to today's behavior. The epilogue is applied at render time rather than stored in the summary, so repeated folds cannot accumulate it; when no `ContextWindowMiddleware` is registered to render it, the middleware warns once instead of failing silently.
