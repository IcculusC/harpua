---
"@harpua/models": patch
---

The openrouter arm passes `sessionId` through to ChatOpenRouter — `OPENROUTER_SESSION_ID` env (prefix-aware, per house convention) or `defaults.openrouter.sessionId`, env winning. Groups an app's requests into OpenRouter dashboard sessions. Requested by the notebook consumer app (which sets it to its thread/project id at launch).
