---
"@harpua/langgraph": patch
---

graph-operations skill (`tool.md`): add guidance on guarding a tool whose input is a model-supplied resource — a URL, filesystem path, or shell argument. Enforce the safe default in the handler rather than only documenting the risk; for URL fetches specifically, default-deny loopback/private/link-local/cloud-metadata hosts, restrict the scheme, and re-check the host after redirects.
