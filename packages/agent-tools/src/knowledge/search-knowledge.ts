import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { errorMessage } from "../web-research/errors";
import {
  resolveSearchKnowledgeOptions,
  type SearchKnowledgeToolOptions,
} from "./options";
import { queryCorpus } from "./corpus-query";

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

      // A BYO store handles its own retrieval; otherwise the built-in corpus
      // path (lazy incremental sync of the markdown root, then cosine scan).
      // The model supplies only the query text — tuning is deployment-config.
      let matches;
      try {
        matches = opts.store
          ? await opts.store.query(queryVector, { topK: opts.topK })
          : await queryCorpus(
              { root, embeddings: opts.embeddings, maxChunkChars: opts.maxChunkChars },
              queryVector,
              { topK: opts.topK },
            );
      } catch (err) {
        return `search_knowledge: retrieval failed (${errorMessage(err)}).`;
      }

      if (matches.length === 0) {
        return (
          "search_knowledge: nothing indexed yet — save some pages first " +
          "(fetch_url / fetch_pdf) or add markdown files to the sources directory."
        );
      }

      // minScore as a tool-side post-filter on the returned score — works for
      // any store, and lets us distinguish "empty corpus" from "all filtered".
      // Equivalent to filtering before top-K, since scores are already sorted.
      const hits =
        opts.minScore === undefined
          ? matches
          : matches.filter((m) => m.score >= opts.minScore!);

      if (hits.length === 0) {
        return `search_knowledge: no chunks scored at or above minScore=${opts.minScore} for "${query}".`;
      }

      return hits
        .map((h, i) => {
          const md = (h.metadata ?? {}) as {
            file?: string;
            startLine?: number;
            endLine?: number;
            headingTrail?: string[];
          };
          const where = md.file ? `${md.file}:${md.startLine}-${md.endLine}` : h.id;
          const trail =
            md.headingTrail && md.headingTrail.length > 0
              ? ` — ${md.headingTrail.join(" > ")}`
              : "";
          const text = h.text
            .split("\n")
            .map((line) => `   ${line}`)
            .join("\n");
          return `${i + 1}. ${where} (score ${h.score.toFixed(2)})${trail}\n${text}`;
        })
        .join("\n");
    },
    {
      name: "search_knowledge",
      description: DESCRIPTION,
      schema: searchKnowledgeInputSchema,
    },
  );
}
