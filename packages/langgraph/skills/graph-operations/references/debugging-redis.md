# Debugging the Redis checkpoint store

Operational playbook for an agent with `redis-cli`. Backend:
`@langchain/langgraph-checkpoint-redis` (`RedisSaver`). State is stored as
**RedisJSON** documents (needs the RediSearch/RedisJSON module, e.g. Redis Stack).

## 1. Connect

Find the connection from the running app's `LangGraphModule.forRoot({ checkpointer })`:
`{ type: "redis", url }` (or a `client` — inspect its options), plus optional
`ttl`. Typical env: `REDIS_URL`. Then:

```bash
redis-cli -u "$REDIS_URL" ping
redis-cli -u "$REDIS_URL" ft._list   # expect: checkpoints, checkpoint_blobs, checkpoint_writes
```

Key layout (colon-delimited; empty `checkpoint_ns` is stored as `__empty__`):

- `checkpoint:{thread_id}:{ns}:{checkpoint_id}` — checkpoint JSON doc.
- `checkpoint_blob:{thread_id}:{ns}:{channel}:{version}` — one channel value.
- `checkpoint_write:{thread_id}:{ns}:{checkpoint_id}:{task_id}:{idx}` — pending write.
- `write_keys_zset:{thread_id}:{ns}:{checkpoint_id}` — write-key index.

## 2. Recipes (one-shot, read-only)

**Find recent threads** — RediSearch over the `checkpoints` index, newest first
by `checkpoint_ts` (epoch ms). Looking for: existing `thread_id`s.

```bash
redis-cli -u "$REDIS_URL" ft.search checkpoints '*' RETURN 2 thread_id checkpoint_ts SORTBY checkpoint_ts DESC LIMIT 0 20
```

**List a thread's checkpoints** (time-travel view), newest first. Looking for:
the `checkpoint_id` to replay from.

```bash
redis-cli -u "$REDIS_URL" ft.search checkpoints '@thread_id:{THREAD}' RETURN 3 checkpoint_id parent_checkpoint_id step SORTBY checkpoint_ts DESC LIMIT 0 50
```

**Read a checkpoint's state.** Unlike Postgres, channel values ARE readable:
`checkpoint_blob` docs store `value` as plain JSON (`type: "json"`). Looking for:
the actual state values.

```bash
redis-cli -u "$REDIS_URL" json.get 'checkpoint:THREAD:__empty__:CKPT' '$.metadata' '$.has_writes'
redis-cli -u "$REDIS_URL" --scan --pattern 'checkpoint_blob:THREAD:__empty__:*'
redis-cli -u "$REDIS_URL" json.get 'checkpoint_blob:THREAD:__empty__:CHANNEL:VERSION' '$.value'
```

**Find threads stuck on an interrupt** — checkpoints with pending writes carry
`has_writes:"true"`. Looking for: threads awaiting resume.

```bash
redis-cli -u "$REDIS_URL" ft.search checkpoints '@has_writes:{true}' RETURN 2 thread_id checkpoint_id SORTBY checkpoint_ts DESC
```

Confirm it's an interrupt via the library: `getState(cfg).tasks[].interrupts`.

**TTL behavior** — set only if `ttl.defaultTTL` (in **minutes**) was configured;
`ttl.refreshOnRead` re-applies it on every read. Check expiry:

```bash
redis-cli -u "$REDIS_URL" ttl 'checkpoint:THREAD:__empty__:CKPT'   # -1 = no TTL, -2 = gone
```

## 3. Time-travel loop

Store finds coordinates; the **library acts** on them:

1. `ft.search` → note `thread_id` + `checkpoint_id`.
2. Replay/fork: `graph.invoke(null, { configurable: { thread_id, checkpoint_id } })`.
3. Or read: `graph.getStateHistory({ configurable: { thread_id } })` (newest first).

> **Read-only in the store.** Never `JSON.SET`/`DEL` checkpoint keys — you'll
> corrupt channel/version/write consistency. To change state, use
> `graph.updateState(cfg, values, asNode?)`, which writes a proper new checkpoint.
