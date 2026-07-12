---
"@harpua/agent-tools": minor
---

Named knowledge backends: `searchKnowledgeTool` gains `name` and `description`
overrides (defaults unchanged), so an app can mount the fetched-sources corpus
and a remembered-excerpts store side by side as two distinctly named tools
(e.g. `search_knowledge` + `search_memory`) and let the agent pick a backend
explicitly. Failure/empty messages carry the resolved name. With a BYO `store`,
`root` is no longer required (it was only ever read by the built-in corpus
retrieval), and the store path's empty message no longer recommends
`fetch_url` (corpus-specific guidance). `rememberTool` gains `searchToolName`
(default `search_knowledge`) so its description and success message point at
the tool that actually reads its store.
