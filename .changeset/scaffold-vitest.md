---
"create-harpua-app": major
---

Scaffolded apps now test with Vitest (with `unplugin-swc` for Nest decorator metadata) instead of Jest. The `test` script is `vitest run`; the `jest` config block, `jest`, `ts-jest` and `@types/jest` are gone from the template.
