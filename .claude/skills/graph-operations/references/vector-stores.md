# Custom vector store for `search_knowledge` (BYO backend)

`@harpua/agent-tools`' `search_knowledge` retrieves by meaning. By default it uses a **built-in on-disk corpus**: point it at a markdown directory and it self-syncs (chunk + embed changed files, cosine scan). You don't need this reference for the default — only when you want the vectors to live somewhere else (pgvector, Pinecone, an existing DB).

## The seam is a `store` option — no DI

`@harpua/agent-tools` tools are plain factories (no Nest module/token). So you bring your own backend by passing a `store` to the factory:

```ts
searchKnowledgeTool({ root, embeddings, store: myStore });
```

Omit `store` → the built-in corpus retrieval (unchanged). Pass one → your backend handles retrieval.

## The `VectorStore` port

```ts
import type { VectorStore, VectorRecord, VectorMatch } from "@harpua/agent-tools";

interface VectorStore<Q = {}> {
  upsert(records: VectorRecord[]): Promise<void>;                 // { id, vector, text, metadata? }
  query(vector: number[], opts?: { topK?: number } & Partial<Q>): Promise<VectorMatch[]>;
  //     ^ scoring + top-K live HERE — a DB pushes the work down
}
```

- **Scoring is the store's job.** `query` returns already-scored, sorted, top-K `VectorMatch[]` (`{ id, score, text, metadata? }`). The tool just formats them, so a DB can rank server-side.
- **Provenance rides in `metadata`.** `search_knowledge` rebuilds its `file:line — heading` output from `match.metadata` (`{ file, startLine, endLine, headingTrail }`). Store it, return it.
- **Tuning is per-adapter, typed.** `Q` is *your* knob surface — the base only guarantees `topK`. Set defaults in your constructor; accept per-call overrides. harpua never standardizes metric/filter/threshold.

## Ingesting a markdown folder into your store

`syncCorpus` bulk-loads a corpus into any store (full re-ingest, idempotent by id):

```ts
import { syncCorpus } from "@harpua/agent-tools";
await syncCorpus({ root: "./sources", embeddings, maxChunkChars: 1200, store: myStore });
```

The built-in corpus default does its own incremental sync internally — you only need `syncCorpus` to feed a *different* store.

## Ingesting from any source — `ingest`

`syncCorpus` is just one source. The primitive under it, `ingest`, takes plain documents from anywhere — a web excerpt, a notebook cell, a DB row — with no disk round-trip:

```ts
import { ingest } from "@harpua/agent-tools";
import type { Document } from "@harpua/agent-tools";

const docs: Document[] = [
  { id: "notes/1", text: "…", metadata: { sourceUrl: "https://…" } },
  { text: "an excerpt with no id" }, // id derived from a content hash → dedupes
];
await ingest(docs, { embeddings, store: myStore });
```

- `Document = { id?: string; text: string; metadata?: Record<string, unknown> }`. Omit `id` and ingest hashes the text, so the same excerpt captured twice collapses to one record set.
- ingest chunks with the built-in markdown chunker, embeds each chunk, and upserts. Your `metadata` rides through opaque (plus chunk `startLine`/`endLine`/`headingTrail`), exactly what `search_knowledge` reads back.
- `syncCorpus({ root, … })` is now `readMarkdownDir(root) → ingest` — the markdown-folder source. Reach for `ingest` directly when your documents don't live on disk as `.md` files.
- Push-only (upsert). Re-ingesting a document with the same id (or same id-less text) replaces its records in place; there is no delete yet.

## Worked example — pgvector via TypeORM

```ts
import type { VectorStore, VectorRecord, VectorMatch } from "@harpua/agent-tools";
import type { DataSource } from "typeorm";

type PgQuery = { where?: string; minScore?: number }; // your typed knobs

export class PgVectorStore implements VectorStore<PgQuery> {
  constructor(
    private readonly ds: DataSource,
    private readonly defaults: { topK?: number } & PgQuery = {},
  ) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    await this.ds.transaction(async (m) => {
      for (const r of records) {
        await m.query(
          `INSERT INTO knowledge (id, embedding, text, metadata)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET embedding = $2, text = $3, metadata = $4`,
          [r.id, JSON.stringify(r.vector), r.text, r.metadata ?? {}],
        );
      }
    });
  }

  async query(vector: number[], opts?: { topK?: number } & Partial<PgQuery>): Promise<VectorMatch[]> {
    const topK = opts?.topK ?? this.defaults.topK ?? 5;
    const where = opts?.where ?? this.defaults.where;
    const rows = await this.ds.query(
      `SELECT id, text, metadata, 1 - (embedding <=> $1) AS score
       FROM knowledge ${where ? `WHERE ${where}` : ""}
       ORDER BY embedding <=> $1 LIMIT $2`,
      [JSON.stringify(vector), topK],
    );
    return rows.map((row: any): VectorMatch => ({
      id: row.id, score: Number(row.score), text: row.text, metadata: row.metadata,
    }));
  }
}
```

Wire it: `searchKnowledgeTool({ root, embeddings, store: new PgVectorStore(dataSource, { topK: 8 }) })`. In a Nest app, build it in your own provider/factory and hand it to the tool.

## Mental model

The built-in corpus is a self-syncing markdown index — **not** a `VectorStore` (that's why it isn't one). A real store is **upsert-on-ingest, query-on-search**: you `upsert` when documents change, `query` on each search. `InMemoryVectorStore` (exported) is a records-only reference implementation and a handy test double.
