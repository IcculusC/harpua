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
  upsert(records: VectorRecord[]): Promise<void>;                 // { id, documentKey, vector, text, metadata? }
  query(vector: number[], opts?: { topK?: number } & Partial<Q>): Promise<VectorMatch[]>;
  //     ^ scoring + top-K live HERE — a DB pushes the work down
  deleteByDocumentKey(documentKey: string): Promise<void>;        // remove all records for one document
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
- **Shrink-correct.** Each record carries a `documentKey` (the doc's id, or a content hash when id-less). `ingest` clears an explicit-id document's prior records (via the store's required `deleteByDocumentKey` — an indexable equality, not a prefix scan) before re-writing it, so trimming a source down — e.g. `syncCorpus` over a folder where a file was cut — removes its orphaned tail chunks; no stale content lingers. Id-less/content-hash documents are immutable-append by design: new text is a new key, and the old version stays as harmless noise.

## The write half — `remember` (agent-curated memory)

`ingest` is the plumbing; `remember` is the tool an agent calls. It saves one excerpt into the store so a later `search_knowledge` can recall it — the agent curates its own notebook memory (download a page → keep the useful passage with its reference → move on):

```ts
import { rememberTool, searchKnowledgeTool } from "@harpua/agent-tools";

const tools = [
  searchKnowledgeTool({ root, embeddings, store }), // read
  rememberTool({ embeddings, store }),              // write — SAME store instance
];
```

- Input `{ text, source?, title? }`. `text` is embedded; `source`/`title` ride along as metadata and `search_knowledge` renders them as `title (source)` in place of `file:line`.
- **Store-required** (unlike `search_knowledge`, which falls back to the on-disk corpus). Omit `store` and the factory throws.
- Remembered excerpts are only visible when `search_knowledge` runs in **store mode over the same store** — in pure corpus mode (no store) it reads disk markdown and never sees them.
- Content-hash dedup: re-remembering identical text upserts in place. The store can delete (`deleteByDocumentKey`, used by `ingest` for shrink-correctness), but there is no agent-facing `forget` tool yet — that UX is a future cycle.

### Wiring into Nest

`remember` is a plain factory *because* `@harpua/agent-tools` is framework-neutral. The Nest-idiomatic seam is your app's provider, where the store's real dependencies (`DataSource`, config) live and DI belongs:

```ts
@Injectable()
export class KnowledgeTools {
  constructor(
    @Inject(KNOWLEDGE_STORE) private readonly store: VectorStore,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingsInterface,
  ) {}

  @LangGraphTool()
  remember = rememberTool({ store: this.store, embeddings: this.embeddings });

  @LangGraphTool()
  searchKnowledge = searchKnowledgeTool({ root: "…", store: this.store, embeddings: this.embeddings });
}
```

The same store instance feeds both tools; DI stays in your app, not in the library.

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
          `INSERT INTO knowledge (id, document_key, embedding, text, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET document_key = $2, embedding = $3, text = $4, metadata = $5`,
          [r.id, r.documentKey, JSON.stringify(r.vector), r.text, r.metadata ?? {}],
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

  async deleteByDocumentKey(documentKey: string): Promise<void> {
    // index document_key: `CREATE INDEX ON knowledge (document_key)`
    await this.ds.query(`DELETE FROM knowledge WHERE document_key = $1`, [documentKey]);
  }
}
```

Wire it: `searchKnowledgeTool({ root, embeddings, store: new PgVectorStore(dataSource, { topK: 8 }) })`. In a Nest app, build it in your own provider/factory and hand it to the tool.

## Mental model

The built-in corpus is a self-syncing markdown index — **not** a `VectorStore` (that's why it isn't one). A real store is **upsert-on-ingest, query-on-search**: you `upsert` when documents change, `query` on each search. `InMemoryVectorStore` (exported) is a records-only reference implementation and a handy test double.
