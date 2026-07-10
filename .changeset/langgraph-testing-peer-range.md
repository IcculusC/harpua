---
"@harpua/langgraph-testing": patch
---

Widen the `@harpua/langgraph` peer range from `workspace:^` (which published as a minor-locked `^0.1.6` in 0.x) to `>=0.1.6 <1.0.0`. The shipped testing surface (scripted models, the Nest testing-module harness) is stable across langgraph's 0.x minors, so a langgraph minor should not force a `langgraph-testing` major. This keeps versions honest — langgraph-testing tracks langgraph across the whole 0.x line and takes its own 0.x bumps — until langgraph reaches 1.0.
