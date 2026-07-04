# Choosing and configuring a checkpointer

Framework-generic. Every compiled graph is given a checkpointer — interrupts and
persistence both require one. Configure it once in
`LangGraphModule.forRoot({ checkpointer })`.

## Choosing a backend

| Backend | `type` | Use when |
|---|---|---|
| Memory | `memory` | Dev and tests; in-process only, lost on restart. The default. |
| SQLite | `sqlite` | Single-node / embedded; `:memory:` for tests that need real serialization. |
| Postgres | `postgres` | Production default — durable, concurrent. |
| Redis | `redis` | TTL-friendly / high-churn threads you want to expire. |
| MongoDB | `mongodb` | Also available; document-store shops. |

## Config shapes (exact option fields)

```ts
{ type: "memory" }

{ type: "sqlite", path: "./checkpoints.db" }   // or path: ":memory:"

{ type: "postgres", connectionString: "postgres://…", schema?: "public" }
{ type: "postgres", pool: myPgPool, schema?: "public" }

{ type: "redis", url: "redis://…", ttl?: { defaultTTL?: 60, refreshOnRead?: true } }
{ type: "redis", client: myRedisClient, ttl?: { /* … */ } }

{ type: "mongodb", url: "mongodb://…", dbName?, checkpointCollectionName?,
  checkpointWritesCollectionName?, ttl?: 3600 }        // ttl in seconds
{ type: "mongodb", client: myMongoClient, dbName? }
```

Any `BaseCheckpointSaver` also plugs in via `{ useExisting: Provider }` or
`{ useFactory, inject }`.

## Optional-peer install model

The four saver packages are **optional peer dependencies**; the library loads
each driver lazily, only inside the factory for its `type`. Install just what you
configure — otherwise bootstrap fails fast with the exact command:

```bash
pnpm add @langchain/langgraph-checkpoint-postgres   # { type: "postgres" }
pnpm add @langchain/langgraph-checkpoint-sqlite     # { type: "sqlite" }
pnpm add @langchain/langgraph-checkpoint-redis      # { type: "redis" }
pnpm add @langchain/langgraph-checkpoint-mongodb    # { type: "mongodb" }
```

`memory` needs no extra package.

## Ownership rule

The distinction is **who created the connection**:

- **Module-created** — you passed a `connectionString` / `url` / `path`. The
  module owns it and closes it on `onApplicationShutdown` (Postgres pool + Redis
  client via `end()`, Mongo client via `close()`, SQLite db via `close()`). This
  fires on process signals only if you enable shutdown hooks:

  ```ts
  app.enableShutdownHooks();
  ```

- **Caller-provided** — you passed a `pool` or a `client`. The module **never**
  closes it; you own its lifecycle.

## Postgres production notes

`PostgresSaver.setup()` (schema/table creation) is awaited **at bootstrap,
before any graph compiles** — you never call it yourself. Set `schema` to
isolate the checkpoint tables (default `public`). Use `connectionString` to let
the module own the pool, or hand it an existing `pg.Pool` when your app already
manages one — the module then builds the schema but never closes the pool.

## Redis TTL semantics

`ttl.defaultTTL` is in **minutes** — checkpoints expire after that idle window.
`ttl.refreshOnRead: true` resets the clock whenever a thread's state is read,
keeping active conversations alive while letting abandoned ones lapse.

## Inspecting the store

To debug persisted state directly (finding threads across runs), see
`debugging-postgres.md` and `debugging-redis.md`.
