---
"create-harpua-app": major
---

ESM scaffold on Nest 12 + @harpua 1.0. The generated project is `"type": "module"` (`NodeNext`, `.js` relative imports, SWC ES output), depends on the `@harpua/*` 1.0 line, and no longer needs the `langchain-single-instance` Vitest plugin. The CLI itself is now ESM too. Requires Node >=22.12.

Migration guide: [MIGRATING-1.0.md](https://github.com/IcculusC/harpua/blob/main/MIGRATING-1.0.md)
