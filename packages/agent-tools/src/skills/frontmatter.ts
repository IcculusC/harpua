/**
 * Minimal `key: value` frontmatter parser — deliberately NOT a YAML library.
 * Skill files are untrusted vendored input; anchors, aliases, and merge keys
 * are attack surface a menu of name/description pairs doesn't need. Only
 * top-level scalar lines are read; everything else is ignored.
 *
 * Returns the raw string map (validation is the caller's zod schema), or
 * `null` when the text has no leading `---` frontmatter block.
 */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  if (!src.startsWith("---")) return null;
  const close = src.indexOf("\n---", 3);
  if (close === -1) return null;

  const out: Record<string, string> = {};
  for (const line of src.slice(3, close).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    // Strip ONE layer of surrounding matched quotes.
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
