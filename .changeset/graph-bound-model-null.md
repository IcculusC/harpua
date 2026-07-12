---
"@harpua/langgraph": patch
---

`provideGraphBoundModel` now throws a named error when the `model` token
resolves to null ("model token <X> resolved to null — check the token's
provider registration") instead of crashing with an anonymous
`Cannot read properties of null (reading 'bindTools')` at first use. Also
adds a per-call model routing recipe to the models skill reference:
`provideGraphBoundModel({ model: getChatModelToken("smart") })` in the
graph's `forFeature` scope + a `wrapModelCall` that swaps via
`req.withModel` — the documented seam for "strong arm for one call, cheap
arm for the loop".
