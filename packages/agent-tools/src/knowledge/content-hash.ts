import { createHash } from "node:crypto";

/**
 * Stable short content id: first 16 hex chars of the SHA-256 of `text`.
 * Byte-identical text yields the same id, so a document ingested without an
 * explicit id upserts in place instead of duplicating when captured twice.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
