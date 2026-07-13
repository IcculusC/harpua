---
"@harpua/langgraph": minor
---

`responseFormatOptions` opens the structured turn-ending call's four fixed choices, all defaults preserving today's behavior: `model` routes the envelope call to any injection token (a smart arm, or a facade provider encoding a fallback policy — this call sits outside `wrapModelCall`, so a token is its only routing seam), `retries` re-asks on thrown failures (provider roulette at the finish line lands after every tool call already succeeded), `messages` selects the envelope's input (a full-history resend prices like a second model call on long turns), and `instruction` replaces the fixed coercion system message.
