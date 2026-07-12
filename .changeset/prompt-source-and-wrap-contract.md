---
"@harpua/langgraph": minor
---

Two agent-loop seams from field reports:

- **`systemPrompt` accepts a source function.** `systemPrompt` now takes
  `string | InjectionToken | (() => string | Promise<string>)`. A source
  function is re-invoked on every model turn, so the system-prompt prefix can
  be rebuilt from mutable state (e.g. a live skill menu) without a
  side-channel middleware — previously a DI-token prompt was fixed after
  first resolution (singleton providers memoize) and no form could express a
  runtime-rebuildable prefix. A class is always treated as a DI token; any
  other function is a source. Rebuilding the prefix resets prompt caching for
  the following turn — that trade-off is the caller's. Unchanged caveat, now
  documented: a request already leading with a persisted `SystemMessage`
  skips the prepend entirely, so a persisted leading `SystemMessage` pins the
  prompt even for a source.

- **`lastNonSystemIsHuman` turn-start helper + `wrapModelCall` composition
  contract documented.** Composed `wrapModelCall` middlewares each receive
  the request as mutated by the middlewares outside them (onion order, first
  in the array = outermost). Two middlewares that both append a
  `SystemMessage` trailer and gate on "the last message is a `HumanMessage`"
  therefore collide: the outer one's trailer hides the human turn and the
  inner one silently never fires. The new `lastNonSystemIsHuman(messages)`
  export is the safe turn-start gate, and the mutated-request contract is now
  stated on the middleware interface docs.
