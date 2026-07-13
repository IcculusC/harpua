---
"@harpua/models": minor
---

OpenRouter arm: `reasoning` and `modelKwargs` passthrough on the arm-scoped defaults. OpenRouter routes one model id across upstreams that disagree about the reasoning channel — calls landing on an instance serving it without the channel leak thinking (or raw provider tool markup) straight into `content`. `reasoning: { enabled: true, exclude: true }` makes every upstream serve the channel without returning it; `modelKwargs` is the generic request-body escape hatch for OpenRouter params the schema doesn't name (`reasoning` wins on key collision). Both ride `ChatOpenRouter`'s `modelKwargs`; absent = unchanged behavior. Reserved keys in `modelKwargs` that would shadow first-class request params (`model`, `tools`, `tool_choice`, `provider`, `models`) are rejected at boot — the lib spreads `modelKwargs` last, so they would silently override the named options.
