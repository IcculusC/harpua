---
"create-harpua-app": patch
---

The scaffolded weather agent now binds its tools to the chat model via
`provideGraphBoundModel` (new `AGENT_BOUND_MODEL` token), so a real model can
actually emit the `get_weather` / `think` tool calls instead of only the
scripted `MockChatModel`. `CallModelNode` injects the bound model. Mock-by-
default is unchanged — `MockChatModel.bindTools` is a no-op that returns itself.
