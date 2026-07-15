---
"@harpua/langgraph": patch
---

`askUserTool(options?)` — a new model-callable tool that lets the model ask
the user one or more typed questions and get answers back as the tool result
mid-turn, instead of emitting a question as prose for a host to reconstruct
after the fact. It joins `requireApproval` as the second member of the
interrupt vocabulary: it pauses with `{ type: "ask_user_request", intro?,
questions }`, and the host resumes with `{ answers: [...] }` (index-aligned
to `questions`) or `{ dismissed: true, reason? }` for headless hosts.

Ships with a flat default question preset (`prompt`, `inputType`:
`select`/`multi_select`/`boolean`/`free_text`, `options?`) that normalizes
`select`/`multi_select` choices (trim, drop empties, dedupe, coerce to
`free_text` below 2 survivors) — or bring your own `questionSchema` (any zod
type extending `{ prompt: string }`) and `serializeAnswers`.
