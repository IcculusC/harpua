import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { errorMessage } from "../web-research/errors";
import { ingest } from "./ingest";
import { MockEmbeddings } from "./mock-embeddings";
import { embeddingsSchema, toolNameSchema, vectorStoreSchema } from "./options";

const makeDescription = (searchToolName: string) =>
  "Save an excerpt or note into this project's searchable knowledge so you " +
  `— or a later step — can find it again with ${searchToolName}. Use it when ` +
  "you hit a passage worth keeping: paste the exact useful text (not the " +
  "whole document), plus where it came from (source URL/citation) and a short title.";

const rememberInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("The exact excerpt/note to save, verbatim — the useful passage, not a whole document."),
  source: z
    .string()
    .optional()
    .describe("Where it came from: a URL or citation, e.g. 'https://…' or 'ACME PSU datasheet §3'."),
  title: z.string().optional().describe("Short human label, e.g. 'dropout voltage at 1 A'."),
});

// Store is REQUIRED (remember writes into a VectorStore); embeddings default to
// the keyless mock for parity with search_knowledge.
const rememberToolOptionsSchema = z.object({
  embeddings: embeddingsSchema.default(() => new MockEmbeddings()),
  store: vectorStoreSchema,
  maxChunkChars: z.number().int().positive().optional(),
  /**
   * Name of the search tool that reads this store — referenced in the
   * description and success message so the loop stays coherent when the
   * reader is mounted under a different name (e.g. `search_memory`).
   */
  searchToolName: toolNameSchema.default("search_knowledge"),
});
export type RememberToolOptions = z.input<typeof rememberToolOptionsSchema>;

/**
 * `remember` — the write half paired with `search_knowledge`'s read. Saves one
 * excerpt/note into a VectorStore via `ingest` (no id → content-hash dedup).
 * Store-required, framework-neutral (no Nest DI). Never throws at call time;
 * a missing store throws at construction.
 */
export function rememberTool(options: RememberToolOptions): StructuredToolInterface {
  const opts = rememberToolOptionsSchema.parse(options);

  return tool(
    async ({ text, source, title }, _config?: RunnableConfig) => {
      const metadata: Record<string, unknown> = {};
      if (source !== undefined) metadata.source = source;
      if (title !== undefined) metadata.title = title;

      let result;
      try {
        result = await ingest([{ text, metadata }], {
          embeddings: opts.embeddings,
          store: opts.store,
          maxChunkChars: opts.maxChunkChars,
        });
      } catch (err) {
        return `remember: could not save (${errorMessage(err)}).`;
      }

      if (result.upserted === 0) return "remember: nothing to save (empty text).";

      const label = title ?? (text.length > 60 ? `${text.slice(0, 60)}…` : text);
      const passages = result.upserted === 1 ? "1 passage" : `${result.upserted} passages`;
      return `remembered: "${label}" — ${passages} now searchable via ${opts.searchToolName}.`;
    },
    {
      name: "remember",
      description: makeDescription(opts.searchToolName),
      schema: rememberInputSchema,
    },
  );
}
