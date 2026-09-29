---
"create-harpua-app": minor
---

Add `--help`/`-h` and `--version`/`-v`; unknown flags now print an error plus usage and exit 1. Scaffolded apps depend on stable `^1.0.0` `@harpua/*` ranges (not `1.0.0-next`) and the scaffolded README title uses the project name instead of a hardcoded `harpua-weather-agent`.
