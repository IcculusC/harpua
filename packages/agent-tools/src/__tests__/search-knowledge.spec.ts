import path from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";

import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { makeTmpDir, removeTmpDir, writeFile, runTool } from "./tmp-tree";

describe("search_knowledge", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeTmpDir(root));

  const seed = () => {
    writeFile(
      root,
      "lm317.md",
      "# LM317\n\n## Electrical Characteristics\n\nDropout voltage 1.5 V at 1 A load.",
    );
    writeFile(
      root,
      "sourdough.md",
      "# Sourdough\n\n## Feeding\n\nFeed the starter with flour and water daily.",
    );
  };

  it("ranks the relevant chunk first with file:line provenance and heading trail", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root }), {
      query: "dropout voltage of the LM317",
    });
    const firstLine = out.split("\n")[0]!;
    expect(firstLine).toContain("lm317.md:");
    expect(firstLine).toMatch(/score/);
    expect(firstLine).toContain("Electrical Characteristics");
    expect(out).toContain("Dropout voltage 1.5 V");
  });

  it("honors topK", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root, topK: 1 }), {
      query: "dropout voltage",
    });
    expect(out).toContain("lm317.md");
    expect(out).not.toContain("sourdough.md");
  });

  it("honors minScore when set", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root, minScore: 0.99 }), {
      query: "zebra xylophone quantum",
    });
    expect(out).toMatch(/search_knowledge: no chunks scored/i);
  });

  it("explains an empty or missing corpus without throwing", async () => {
    const out = await runTool(searchKnowledgeTool({ root }), { query: "anything" });
    expect(out).toMatch(/nothing indexed yet/i);
    const missing = await runTool(
      searchKnowledgeTool({ root: path.join(root, "nope") }),
      { query: "anything" },
    );
    expect(missing).toMatch(/nothing indexed yet/i);
  });

  it("resolves root from the run config (per-thread corpora)", async () => {
    writeFile(root, "buck-v1/lm317.md", "## Specs\n\nDropout 1.5 V.");
    const tool = searchKnowledgeTool({
      root: (config?: RunnableConfig) =>
        path.join(
          root,
          ((config?.configurable as { thread_id?: string } | undefined)?.thread_id ??
            "default"),
        ),
    });
    const out = (await tool.invoke(
      { query: "dropout" },
      { configurable: { thread_id: "buck-v1" } },
    )) as unknown;
    expect(String((out as { content?: unknown })?.content ?? out)).toContain("lm317.md");
  });

  it("excludes non-finite scores from ranking (never prints score NaN)", async () => {
    seed();
    // MockEmbeddings tokenizes on [a-z0-9]+, so a punctuation-only query embeds
    // to the zero vector; cosine similarity against it is NaN for every chunk.
    const out = await runTool(searchKnowledgeTool({ root }), { query: "!!! --- ???" });
    expect(out).not.toMatch(/score NaN/i);
    expect(out).not.toMatch(/NaN/);
  });

  it("returns embedder failures as friendly strings", async () => {
    seed();
    const failing = {
      embedDocuments: async () => {
        throw new Error("401 from embeddings endpoint");
      },
      embedQuery: async () => {
        throw new Error("401 from embeddings endpoint");
      },
    };
    const out = await runTool(searchKnowledgeTool({ root, embeddings: failing }), {
      query: "anything",
    });
    expect(out).toMatch(/^search_knowledge:/);
    expect(out).toContain("401");
  });
});
