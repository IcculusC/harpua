---
"@harpua/agent-tools": patch
---

Add the web-research tool family: `web_search` (SearXNG-backed search) and `fetch_url` (fetch a page, convert HTML to markdown with a dependency-free extractor, save with frontmatter), plus a `webResearchTools()` bundle. Pair with `fileExplorationTools` over the same directory to search saved pages.

`fetch_url` refuses loopback/private/link-local addresses by default (including redirects that resolve to one) as an SSRF safety net; pass `allowPrivate: true` to reach a service on localhost or the LAN.
