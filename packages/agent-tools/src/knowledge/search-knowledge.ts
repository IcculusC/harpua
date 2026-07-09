import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { similarity } from "ml-distance";
import { z } from "zod";

import { errorMessage } from "../web-research/errors";
import {
  resolveSearchKnowledgeOptions,
  type SearchKnowledgeToolOptions,
} from "./options";
import { syncIndex } from "./knowledge-index";

const DESCRIPTION =
  "Search everything saved in this project's sources (fetched web pages, " +
  "extracted PDFs, notes) by MEANING, not just keywords. Ask a natural-" +
  "language question; you get the most relevant passages with file and line " +
  "references — quote them, or use read_lines on a reference for full " +
  "context. Prefer this over search_files when you don't know the exact " +
  "wording on the page.";

const searchKnowledgeInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A natural-language question or topic, e.g. 'what is the dropout voltage at 1 A?'",
    ),
});

/**
 * `search_knowledge` — semantic-ish retrieval over a directory of markdown.
 * Each call lazily syncs the sidecar index (only new/changed files are
 * re-embedded), embeds the query, and returns the top-k cosine matches with
 * file:line provenance. Keyless by default via the lexical MockEmbeddings;
 * pass any LangChain embeddings instance for real semantics. Never throws:
 * empty corpora, embedder failures, and index-write failures all come back
 * as strings. The model supplies only the query — the corpus root comes
 * from options or the run config, never from model input.
 */
export function searchKnowledgeTool(
  options: SearchKnowledgeToolOptions,
): StructuredToolInterface {
  const opts = resolveSearchKnowledgeOptions(options);

  return tool(
    async ({ query }, config?: RunnableConfig) => {
      const root = typeof opts.root === "function" ? opts.root(config) : opts.root;

      let queryVector: number[];
      try {
        queryVector = await opts.embeddings.embedQuery(query);
      } catch (err) {
        return `search_knowledge: the embeddings backend failed (${errorMessage(err)}).`;
      }

      let sync;
      try {
        sync = await syncIndex({
          root,
          embeddings: opts.embeddings,
          maxChunkChars: opts.maxChunkChars,
          expectedDimension: queryVector.length,
        });
      } catch (err) {
        return `search_knowledge: indexing the sources failed (${errorMessage(err)}).`;
      }

      const scored = Object.entries(sync.index.files)
        .flatMap(([file, entry]) =>
          entry.chunks.map((chunk) => ({
            file,
            chunk,
            score: similarity.cosine(queryVector, chunk.vector),
          })),
        )
        // NaN shows up when either vector has zero magnitude (e.g. a
        // punctuation-only query, or an empty chunk) — cosine is undefined
        // there, so exclude it rather than let it sort/print as "score NaN".
        .filter((s) => Number.isFinite(s.score));

      if (scored.length === 0) {
        return (
          "search_knowledge: nothing indexed yet — save some pages first " +
          "(fetch_url / fetch_pdf) or add markdown files to the sources directory."
        );
      }

      scored.sort((a, b) => b.score - a.score);
      const hits = scored
        .filter((s) => opts.minScore === undefined || s.score >= opts.minScore)
        .slice(0, opts.topK);

      if (hits.length === 0) {
        return `search_knowledge: no chunks scored at or above minScore=${opts.minScore} for "${query}".`;
      }

      const body = hits
        .map(({ file, chunk, score }, i) => {
          const trail =
            chunk.headingTrail.length > 0 ? ` — ${chunk.headingTrail.join(" > ")}` : "";
          const text = chunk.text
            .split("\n")
            .map((line) => `   ${line}`)
            .join("\n");
          return `${i + 1}. ${file}:${chunk.startLine}-${chunk.endLine} (score ${score.toFixed(2)})${trail}\n${text}`;
        })
        .join("\n");

      return sync.persistError
        ? `${body}\n(note: index cache could not be written: ${sync.persistError})`
        : body;
    },
    {
      name: "search_knowledge",
      description: DESCRIPTION,
      schema: searchKnowledgeInputSchema,
    },
  );
}
