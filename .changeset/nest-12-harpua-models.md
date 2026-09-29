---
"@harpua/models": major
---

Requires NestJS 12 (peer range `^12.0.0`). Migration: upgrade `@nestjs/common`, `@nestjs/core` (and `@nestjs/testing` if you use it) to v12 on Node 20.19+, 22.12+ or 24+. Still ships CommonJS; Nest 12's ESM-only packages load through Node's `require(esm)`. Jest cannot load Nest 12 on its own, see the Nest 12 migration guide.
