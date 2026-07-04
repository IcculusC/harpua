# Debugging the Postgres checkpoint store

Operational playbook for an agent with `psql`. Backend:
`@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`).

## 1. Connect

Find the connection from the running app's `LangGraphModule.forRoot({ checkpointer })`:
`{ type: "postgres", connectionString }` (or a `pool` — inspect its config), plus
a `schema` (default `public`). Typical env: `DATABASE_URL`, `PG*`. Then:

```bash
psql "$DATABASE_URL" -c '\dt public.*'   # confirm the four tables exist
```

Tables: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`,
`checkpoint_migrations`. Non-default schema? Prefix every table
(`"myschema".checkpoints`) or run `psql "$DATABASE_URL" -c 'SET search_path=myschema'`.

## 2. Recipes (one-shot, read-only)

**List recent threads** — latest checkpoint per `thread_id`, newest first.
Looking for: which threads exist and when they last advanced.

```bash
psql "$DATABASE_URL" -Ax -c "select distinct on (thread_id) thread_id, checkpoint_id, metadata->>'step' AS step, metadata->>'source' AS source from public.checkpoints order by thread_id, checkpoint_id desc;"
```

**Dump one thread's history** (time-travel view) — every checkpoint, newest
first. `checkpoint_id` is a UUIDv6, so `desc` = reverse-chronological. Looking
for: the `checkpoint_id` to replay from.

```bash
psql "$DATABASE_URL" -Ax -c "select checkpoint_id, parent_checkpoint_id, metadata->>'step' AS step, metadata->>'writes' AS writes from public.checkpoints where thread_id='THREAD' order by checkpoint_id desc;"
```

**Inspect one checkpoint's channel values.** The `checkpoints.checkpoint` column
is JSONB (readable directly) but holds only channel *versions*, not values. The
actual state values live in `checkpoint_blobs.blob` as **BYTEA**, msgpack-encoded
(`type` column, e.g. `msgpack`) — not human-readable in SQL. Read the version map
from JSONB, but get the decoded values from the library (`getState().values`).
Looking for: which channels exist / the version pointers.

```bash
psql "$DATABASE_URL" -Ax -c "select checkpoint->'channel_versions' from public.checkpoints where thread_id='THREAD' and checkpoint_id='CKPT';"
psql "$DATABASE_URL" -Ax -c "select channel, type, version, octet_length(blob) AS bytes from public.checkpoint_blobs where thread_id='THREAD' order by channel;"
```

**Find threads stuck on an interrupt** — pending writes/tasks are rows in
`checkpoint_writes`. Looking for: threads whose latest checkpoint still has
unresolved writes (an interrupt awaiting resume).

```bash
psql "$DATABASE_URL" -Ax -c "select distinct cw.thread_id, cw.checkpoint_id, cw.channel from public.checkpoint_writes cw order by cw.thread_id;"
```

Confirm it's an interrupt (not just normal pending work) via the library:
`getState(cfg).tasks[].interrupts`.

## 3. Time-travel loop

Store finds coordinates; the **library acts** on them:

1. `select ... from checkpoints where thread_id=...` → note `thread_id` + `checkpoint_id`.
2. Replay/fork: `graph.invoke(null, { configurable: { thread_id, checkpoint_id } })`.
3. Or read: `graph.getStateHistory({ configurable: { thread_id } })` (newest first,
   matching the SQL `order by checkpoint_id desc`).

> **Read-only in the store.** Never `UPDATE`/`INSERT`/`DELETE` checkpoint tables —
> you'll corrupt channel-version/blob consistency. To change state, use
> `graph.updateState(cfg, values, asNode?)`, which writes a proper new checkpoint.
