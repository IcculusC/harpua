# harpua

A Turborepo monorepo managed with pnpm workspaces.

## Structure

- `apps/api` — NestJS 11 API (SWC builder)
- `packages/typescript-config` — shared `tsconfig` bases
- `packages/eslint-config` — shared flat ESLint config

## Requirements

- Node.js >= 20 (developed against v23.10.0)
- pnpm 9.15.0 (`packageManager` pinned in `package.json`)

## Usage

```bash
pnpm install
pnpm build
pnpm dev
pnpm lint
pnpm test
```
