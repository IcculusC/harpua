---
"@harpua/models": patch
---

Log one line per resolved chat-model registration at boot (Nest `Logger`,
context `ChatModelModule`) naming the active arm and, for a real arm, the
concrete model id — e.g. `model "default" -> mock (built-in)` /
`model "fast" -> openrouter (deepseek/deepseek-v4-flash)`. Makes an env flip
visible instead of silent; never logs api keys or base URLs.
