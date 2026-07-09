import fs from "node:fs";
import path from "node:path";

/** Tiny stable FNV-1a hash — content-independent, dependency-free. */
function urlHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Filename slug for a saved page: the page title (fallback: URL host+path),
 * lowercased and reduced to [a-z0-9-], capped at 60 chars, plus a short hash
 * of the full URL so distinct URLs never collide and re-fetching the same URL
 * overwrites its file.
 */
export function pageSlug(title: string | undefined, url: URL): string {
  const source =
    title && title.trim().length > 0 ? title : `${url.host}${url.pathname}`;
  const base =
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "page";
  return `${base}-${urlHash(url.toString())}`;
}

export interface SavePageInput {
  /** Directory to write into (created recursively if missing). */
  dir: string;
  /** The fetched URL (recorded in frontmatter; hashed into the filename). */
  url: URL;
  /** Page title for the frontmatter and slug, when known. */
  title?: string;
  /** The extracted markdown body. */
  markdown: string;
  /** YYYY-MM-DD fetch date for the frontmatter. */
  fetched: string;
}

/**
 * Write a fetched page as `<slug>.md` with YAML frontmatter (url, title,
 * fetched). Returns the absolute path written. Same URL → same path, so a
 * re-fetch refreshes the file instead of duplicating it.
 */
export function savePage(input: SavePageInput): string {
  fs.mkdirSync(input.dir, { recursive: true });
  const file = path.join(input.dir, `${pageSlug(input.title, input.url)}.md`);
  const lines = ["---", `url: ${input.url.toString()}`];
  if (input.title) {
    lines.push(`title: "${input.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  }
  lines.push(`fetched: ${input.fetched}`, "---", "", input.markdown, "");
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}
