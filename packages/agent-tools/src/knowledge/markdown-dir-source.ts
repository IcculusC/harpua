import fs from "node:fs";
import path from "node:path";
import type { Document } from "./ingest";

/**
 * The markdown-directory source: list `*.md` files under `root` as ingestable
 * documents (id = filename, metadata = { file }). A missing directory yields
 * `[]` — nothing to ingest. This is one source among many; `ingest` takes it
 * from here.
 */
export function readMarkdownDir(root: string): Document[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    return []; // missing corpus dir → nothing to ingest
  }
  return names.map((file) => ({
    id: file,
    text: fs.readFileSync(path.join(root, file), "utf8"),
    metadata: { file },
  }));
}
