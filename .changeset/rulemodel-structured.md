---
"@harpua/langgraph-testing": minor
---

Add `.structured(value)` to the `ruleModel()` builder (`RuleModelBuilder`), matching the existing method on `scriptedModel()`'s `ScriptedModelBuilder`. This lets a rule-based fake serve as both a tool-loop model and a `withStructuredOutput` summarizer in the same test — required to end-to-end exercise the context-compaction `summarize` strategy against a real checkpointer.
