---
"@harpua/langgraph": patch
---

`computeFold` can now fold mid-turn: when the protected tail is all ai/tool messages (a long tool loop) and no HumanMessage exists at/after the naive cut, the cut falls back to the LAST HumanMessage before it — keeping more than `keepRecent` (always safe) with the retained history still opening on a human. Previously the forward-only scan returned null every cycle exactly when relief was needed, so a token trigger fired forever while the whole tool loop rode at peak context.
